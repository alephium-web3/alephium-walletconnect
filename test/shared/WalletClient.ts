import Client, { CLIENT_EVENTS } from "@walletconnect/client";
import { ClientOptions, IClient, SessionTypes } from "@walletconnect/types";
import { ERROR } from "@walletconnect/utils";
import { SIGNER_EVENTS } from "@walletconnect/signer-connection";
import { formatJsonRpcError, formatJsonRpcResult } from "@walletconnect/jsonrpc-utils";
import { node, convertHttpResponse, CliqueClient, Signer, PrivateKeySigner } from "alephium-web3";

import { Account, AlephiumProvider } from "../../src";

export interface WalletClientOpts {
  privateKey: string;
  networkId: number;
  rpcUrl: string;
}

export type WalletClientAsyncOpts = WalletClientOpts & ClientOptions;

export class WalletClient {
  public provider: AlephiumProvider;
  public cliqueClient: CliqueClient;
  public signer: Signer;
  public networkId: number;
  public rpcUrl: string;

  public client?: IClient;
  public topic?: string;

  static async init(
    provider: AlephiumProvider,
    opts: Partial<WalletClientAsyncOpts>,
  ): Promise<WalletClient> {
    const walletClient = new WalletClient(provider, opts);
    await walletClient.initialize(opts);
    return walletClient;
  }

  get group(): number {
    return this.signer.group;
  }

  get accounts(): Account[] {
    return [
      {
        networkId: this.networkId,
        address: this.signer.address,
        pubkey: this.signer.publicKey,
        group: this.signer.group,
      },
    ];
  }

  constructor(provider: AlephiumProvider, opts: Partial<WalletClientOpts>) {
    this.provider = provider;
    this.networkId = opts?.networkId || 4;
    this.rpcUrl = opts?.rpcUrl || "http://127.0.0.1:22973";
    this.cliqueClient = new CliqueClient({ baseUrl: this.rpcUrl });
    this.signer = this.getWallet(this.cliqueClient, opts.privateKey);
  }

  public async changeAccount(privateKey: string) {
    this.setAccount(privateKey);
    await this.updateAccounts();
  }

  public async changeChain(networkId: number, rpcUrl: string) {
    this.setChainId(networkId, rpcUrl);
    await this.updateChain();
  }

  public async disconnect() {
    if (!this.client) return;
    if (!this.topic) return;
    await this.client.disconnect({ topic: this.topic, reason: ERROR.USER_DISCONNECTED.format() });
  }

  private setAccount(privateKey: string) {
    this.signer = this.getWallet(this.cliqueClient, privateKey);
  }

  private setChainId(networkId: number, rpcUrl: string) {
    if (this.networkId !== networkId) {
      this.networkId = networkId;
    }
    if (this.rpcUrl !== rpcUrl) {
      this.rpcUrl = rpcUrl;
    }
  }

  private async emitAccountsChangedEvent() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const notification = { type: "accountsChanged", data: [this.signer.address] };
    await this.client.notify({ topic: this.topic, notification });
  }

  private async emitChainChangedEvent() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    const notification = { type: "chainChanged", data: this.networkId };
    await this.client.notify({ topic: this.topic, notification });
  }

  private getWallet(cliqueClient: CliqueClient, privateKey?: string): Signer {
    const wallet =
      typeof privateKey !== "undefined"
        ? new PrivateKeySigner(cliqueClient, privateKey)
        : PrivateKeySigner.createRandom(cliqueClient);
    return wallet;
  }

  private getSessionState() {
    const account = `alephium:${this.networkId}:${this.signer.address}:${this.signer.publicKey}:${this.signer.group}`;
    return { accounts: [account] };
  }

  private async updateSession() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    await this.client.update({ topic: this.topic, state: this.getSessionState() });
  }

  private async upgradeSession() {
    if (typeof this.client === "undefined") return;
    if (typeof this.topic === "undefined") return;
    await this.client.upgrade({
      topic: this.topic,
      permissions: { blockchain: { chains: [`alephium:${this.networkId}:${this.signer.group}`] } },
    });
    await this.updateAccounts();
  }

  private async updateAccounts() {
    await this.updateSession();
    await this.emitAccountsChangedEvent();
  }

  private async updateChain() {
    await this.upgradeSession();
    await this.emitChainChangedEvent();
  }

  private async initialize(opts?: ClientOptions) {
    this.client = await Client.init({ ...opts, controller: true });
    this.registerEventListeners();
  }

  private registerEventListeners() {
    if (typeof this.client === "undefined") {
      throw new Error("Client not initialized");
    }

    // auto-pair
    this.provider.signer.connection.on(SIGNER_EVENTS.uri, async ({ uri }) => {
      if (typeof this.client === "undefined") {
        throw new Error("Client not initialized");
      }
      await this.client.pair({ uri });
    });

    // auto-approve
    this.client.on(CLIENT_EVENTS.session.proposal, async (proposal: SessionTypes.Proposal) => {
      if (typeof this.client === "undefined") {
        throw new Error("Client not initialized");
      }
      const response = { state: this.getSessionState() };
      const session = await this.client.approve({ proposal, response });
      this.topic = session.topic;
    });

    // auto-respond
    this.client.on(
      CLIENT_EVENTS.session.request,
      async (requestEvent: SessionTypes.RequestEvent) => {
        if (typeof this.client === "undefined") {
          throw new Error("Client not initialized");
        }
        const { topic, chainId, request } = requestEvent;
        const chain = chainId; // just a rename

        // ignore if unmatched topic
        if (topic !== this.topic) return;

        try {
          // reject if no present target chain
          if (typeof chain === "undefined") {
            throw new Error("Missing target chain");
          }
          const [_, networkId, group] = chain.split(":");
          // reject if unmatched chain
          if (Number(networkId) !== this.networkId || Number(group) != this.group) {
            throw new Error(
              `Target chain (${networkId}, ${group}) does not match active chain (${this.networkId}, ${this.group})`,
            );
          }

          let result: any;

          switch (request.method) {
            case "alph_signTransferTx":
              result = convertHttpResponse(
                await this.cliqueClient.transactions.postTransactionsBuild(
                  (request as any) as node.BuildTransaction,
                ),
              );
              break;
            case "alph_signContractCreationTx":
              result = convertHttpResponse(
                await this.cliqueClient.contracts.postContractsUnsignedTxBuildContract(
                  (request as any) as node.BuildContractDeployScriptTx,
                ),
              );
              break;
            case "alph_signScriptTx":
              result = convertHttpResponse(
                await this.cliqueClient.contracts.postContractsUnsignedTxBuildScript(
                  (request as any) as node.BuildScriptTx,
                ),
              );
              break;
            case "alph_signMessage":
              result = convertHttpResponse(
                await this.cliqueClient.transactions.postTransactionsSubmit(
                  (request as any) as node.SubmitTransaction,
                ),
              );
              break;
            default:
              throw new Error(`Method not supported: ${request.method}`);
          }

          // reject if undefined result
          if (typeof result === "undefined") {
            throw new Error("Result was undefined");
          }

          const response = formatJsonRpcResult(request.id, result);
          await this.client.respond({ topic, response });
        } catch (e) {
          const message = e.message || e.toString();
          const response = formatJsonRpcError(request.id, message);
          await this.client.respond({ topic, response });
        }
      },
    );
  }
}
