import { EventEmitter } from "eventemitter3";
import { JsonRpcProvider } from "@walletconnect/jsonrpc-provider";
import { RequestArguments } from "@walletconnect/jsonrpc-utils";
import { HttpConnection } from "@walletconnect/jsonrpc-http-connection";
import { SessionTypes } from "@walletconnect/types";
import {
  SignerConnection,
  SIGNER_EVENTS,
  SignerConnectionClientOpts,
} from "@walletconnect/signer-connection";
import { node } from "alephium-web3";

/*
 * Note:
 * 1. the client could potentially submit the signed transaction
 * 2. the client could disable the support of `alph_signMessage`
 */
export const signerMethods = [
  "alph_getAccounts",
  "alph_signTransferTx",
  "alph_signContractCreationTx",
  "alph_signScriptTx",
  "alph_signMessage",
];
export interface Account {
  chainId: number;
  address: string;
  pubkey: string;
  group: number;
}
export type GetAccountsResult = Account[];
export interface SignResult {
  unsignedTx: string;
  txId: string;
  signature: string;
  submitted: boolean;
}
export type BuildTransferTxParams = node.BuildTransaction;
export type BuildTransferTxResult = SignResult;
export type BuildContractCreationTxParams = node.BuildContractDeployScriptTx;
export type BuildContractCreationTxResult = SignResult;
export type BuildScriptTxParams = node.BuildScriptTx;
export type BuildScriptTxResult = SignResult;
export type SignMessageParams = { message: string };
export type SignMessageResult = { signature: string };

export const providerEvents = {
  changed: {
    chain: "chainChanged",
    accounts: "accountsChanged",
  },
};

export interface AlephiumRpcConfig {
  custom?: {
    [chainId: string]: string;
  };
}

export function getRpcUrl(chainId: number, rpc?: AlephiumRpcConfig): string | undefined {
  let rpcUrl: string | undefined;
  if (rpc && rpc.custom) {
    rpcUrl = rpc.custom[chainId];
  }
  return rpcUrl;
}

export interface AlephiumProviderOptions {
  chainId: number;
  chainGroup: number;
  methods?: string[];
  rpc?: AlephiumRpcConfig;
  client?: SignerConnectionClientOpts;
}

class AlephiumProvider {
  public events: any = new EventEmitter();

  private rpc: AlephiumRpcConfig | undefined;

  public namespace = "alephium";
  public chainId: number;
  public chainGroup: number;
  public methods = signerMethods;

  public accounts: Account[] = [];

  public signer: JsonRpcProvider;
  public http: JsonRpcProvider | undefined;

  constructor(opts: AlephiumProviderOptions) {
    this.rpc = opts.rpc;
    this.chainId = opts.chainId;
    this.chainGroup = opts.chainGroup;
    this.methods = opts.methods ? [...opts.methods, ...this.methods] : this.methods;
    this.signer = this.setSignerProvider(opts.client);
    this.http = this.setHttpProvider(this.chainId);
    this.registerEventListeners();
  }

  public async request<T = unknown>(args: RequestArguments, chainId?: string): Promise<T> {
    if (args.method === "alph_getAccounts") {
      return this.accounts as any;
    }
    if (this.methods.includes(args.method)) {
      return this.signer.request(args, {
        chain: this.formatChain(this.chainId, this.chainGroup),
      });
    }
    return Promise.reject(`Invalid method was passed ${args.method}`);
  }

  public async connect(): Promise<GetAccountsResult> {
    await this.signer.connect();
    return this.accounts;
  }

  get connected(): boolean {
    return (this.signer.connection as SignerConnection).connected;
  }

  get connecting(): boolean {
    return (this.signer.connection as SignerConnection).connecting;
  }

  public async disconnect(): Promise<void> {
    await this.signer.disconnect();
  }

  public on(event: any, listener: any): void {
    this.events.on(event, listener);
  }
  public once(event: string, listener: any): void {
    this.events.once(event, listener);
  }
  public removeListener(event: string, listener: any): void {
    this.events.removeListener(event, listener);
  }
  public off(event: string, listener: any): void {
    this.events.off(event, listener);
  }

  get isWalletConnect() {
    return true;
  }

  // ---------- Private ----------------------------------------------- //

  private registerEventListeners() {
    this.signer.on("connect", async () => {
      const chains = (this.signer.connection as SignerConnection).chains;
      if (chains && chains.length) this.setChain(chains);
      const accounts = (this.signer.connection as SignerConnection).accounts;
      if (accounts && accounts.length) this.setAccounts(accounts);
    });
    this.signer.connection.on(SIGNER_EVENTS.created, (session: SessionTypes.Settled) => {
      this.setChain(session.permissions.blockchain.chains);
      this.setAccounts(session.state.accounts);
    });
    this.signer.connection.on(SIGNER_EVENTS.updated, (session: SessionTypes.Settled) => {
      const chain = this.formatChain(this.chainId, this.chainGroup);
      if (!session.permissions.blockchain.chains.includes(chain)) {
        this.setChain(session.permissions.blockchain.chains);
      }
      if (session.state.accounts.map(this.parseAccount) !== this.accounts) {
        this.setAccounts(session.state.accounts);
      }
    });
    this.signer.connection.on(
      SIGNER_EVENTS.notification,
      (notification: SessionTypes.Notification) => {
        if (notification.type === providerEvents.changed.accounts) {
          this.accounts = notification.data;
          this.events.emit(providerEvents.changed.accounts, this.accounts);
        } else if (notification.type === providerEvents.changed.chain) {
          this.chainId = notification.data;
          this.events.emit(providerEvents.changed.chain, this.chainId);
        } else {
          this.events.emit(notification.type, notification.data);
        }
      },
    );
    this.signer.on("disconnect", () => {
      this.events.emit("disconnect");
    });
    this.events.on(providerEvents.changed.chain, chainId => this.setHttpProvider(chainId));
  }

  private setSignerProvider(client?: SignerConnectionClientOpts) {
    const connection = new SignerConnection({
      chains: [this.formatChain(this.chainId, this.chainGroup)],
      methods: this.methods,
      client,
    });
    return new JsonRpcProvider(connection);
  }

  private setHttpProvider(chainId: number): JsonRpcProvider | undefined {
    const rpcUrl = getRpcUrl(chainId, this.rpc);
    if (typeof rpcUrl === "undefined") return undefined;
    const http = new JsonRpcProvider(new HttpConnection(rpcUrl));
    return http;
  }

  private isCompatibleChain(chain: string): boolean {
    return chain.startsWith(`${this.namespace}:`);
  }

  private formatChain(chainId: number, chainGroup: number): string {
    return `${this.namespace}:${chainId}:${chainGroup}`;
  }

  private parseChain(chainString: string): [number, number] {
    const [_ /* namespace */, chainId, chainGroup] = chainString.split(":");
    return [Number(chainId), Number(chainGroup)];
  }

  private setChain(chains: string[]) {
    const compatible = chains.filter(x => this.isCompatibleChain(x));
    if (compatible.length) {
      [this.chainId, this.chainGroup] = this.parseChain(compatible[0]);
      this.events.emit(providerEvents.changed.chain, [this.chainId, this.chainGroup]);
    }
  }

  private parseAccount(account: string): Account {
    const [_ /* namespace */, chainId, address, pubkey, group] = account.split(":");
    return {
      chainId: Number(chainId),
      address: address,
      pubkey: pubkey,
      group: Number(group),
    };
  }

  private setAccounts(accounts: string[]) {
    this.accounts = accounts
      .map(this.parseAccount)
      .filter(account => account.chainId === this.chainId && account.group === this.chainGroup);
    this.events.emit(providerEvents.changed.accounts, this.accounts);
  }
}

export default AlephiumProvider;
