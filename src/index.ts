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
import {
  node,
  SignerProvider,
  SignTransferTxParams,
  SignTransferTxResult,
  SignContractCreationTxParams,
  SignContractCreationTxResult,
  SignScriptTxParams,
  SignScriptTxResult,
  SignUnsignedTxParams,
  SignUnsignedTxResult,
  SignHexStringParams,
  SignHexStringResult,
  SignMessageParams,
  SignMessageResult,
} from "alephium-web3";

// Note:
// 1. the wallet client could potentially submit the signed transaction.
// 2. `alph_signUnsignedTx` can be used for complicated transactions (e.g. multisig).
export const signerMethods = [
  "alph_getAccounts",
  "alph_signTransferTx",
  "alph_signContractCreationTx",
  "alph_signScriptTx",
  "alph_signUnsignedTx",
  "alph_signHexString",
  "alph_signMessage",
];
type SignerMethodsTuple = typeof signerMethods;
type SignerMethods = SignerMethodsTuple[number];
export interface Account {
  address: string;
  pubkey: string;
  group: number;
}
export type GetAccountsParams = undefined;
export type GetAccountsResult = Account[];
export interface SignResult {
  unsignedTx: string;
  txId: string;
  signature: string;
}

interface SignerMethodsTable extends Record<SignerMethods, { params: any; result: any }> {
  alph_getAccounts: {
    params: GetAccountsParams;
    result: GetAccountsResult;
  };
  alph_signTransferTx: {
    params: SignTransferTxParams;
    result: SignTransferTxResult;
  };
  alph_signContractCreationTx: {
    params: SignContractCreationTxParams;
    result: SignContractCreationTxResult;
  };
  alph_signScriptTx: {
    params: SignScriptTxParams;
    result: SignScriptTxResult;
  };
  alph_signUnsignedTx: {
    params: SignUnsignedTxParams;
    result: SignUnsignedTxResult;
  };
  alph_signHexString: {
    params: SignHexStringParams;
    result: SignHexStringResult;
  };
  alph_signMessage: {
    params: SignMessageParams;
    result: SignMessageResult;
  };
}
export type MethodParams<T extends SignerMethods> = SignerMethodsTable[T]["params"];
export type MethodResult<T extends SignerMethods> = SignerMethodsTable[T]["result"];

export const providerEvents = {
  changed: {
    chain: "chainChanged",
    accounts: "accountsChanged",
  },
};

export interface AlephiumRpcConfig {
  custom?: {
    [networkId: string]: string;
  };
}

export function getRpcUrl(networkId: number, rpc?: AlephiumRpcConfig): string | undefined {
  let rpcUrl: string | undefined;
  if (rpc && rpc.custom) {
    rpcUrl = rpc.custom[networkId];
  }
  return rpcUrl;
}

export interface AlephiumProviderOptions {
  networkId: number;
  chainGroup: number;
  methods?: string[];
  rpc?: AlephiumRpcConfig;
  client?: SignerConnectionClientOpts;
}

class AlephiumProvider implements SignerProvider {
  public events: any = new EventEmitter();

  private rpc: AlephiumRpcConfig | undefined;

  public static namespace = "alephium";
  public networkId: number;
  public chainGroup: number;
  public methods = signerMethods;

  public accounts: Account[] = [];

  public signer: JsonRpcProvider;
  public http: JsonRpcProvider | undefined;

  constructor(opts: AlephiumProviderOptions) {
    this.rpc = opts.rpc;
    this.networkId = opts.networkId;
    this.chainGroup = opts.chainGroup;
    this.methods = opts.methods ? [...opts.methods, ...this.methods] : this.methods;
    this.signer = this.setSignerProvider(opts.client);
    this.http = this.setHttpProvider(this.networkId);
    this.registerEventListeners();
  }

  // The provider only supports signer methods. The other requests should use Alephium Rest API.
  public async request<T = unknown>(args: RequestArguments): Promise<T> {
    if (args.method === "alph_getAccounts") {
      return this.accounts as any;
    }
    if (this.methods.includes(args.method)) {
      return this.signer.request(args, {
        chainId: AlephiumProvider.formatChain(this.networkId, this.chainGroup),
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

  // ---------- Methods ----------------------------------------------- //

  private typedRequest<T extends SignerMethods>(
    method: T,
    params: MethodParams<T>,
  ): Promise<MethodResult<T>> {
    return this.request({ method: method, params: params });
  }

  public getAccounts(): Promise<Account[]> {
    return this.typedRequest("alph_getAccounts", undefined);
  }

  public async signTransferTx(params: SignTransferTxParams): Promise<SignTransferTxResult> {
    return this.typedRequest("alph_signTransferTx", params);
  }

  public async signContractCreationTx(
    params: SignContractCreationTxParams,
  ): Promise<SignContractCreationTxResult> {
    return this.typedRequest("alph_signContractCreationTx", params);
  }

  public async signScriptTx(params: SignScriptTxParams): Promise<SignScriptTxResult> {
    return this.typedRequest("alph_signScriptTx", params);
  }

  public async signUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    return this.typedRequest("alph_signUnsignedTx", params);
  }

  public async signHexString(params: SignHexStringParams): Promise<SignHexStringResult> {
    return this.typedRequest("alph_signHexString", params);
  }

  public async signMessage(params: SignMessageParams): Promise<SignMessageResult> {
    return this.typedRequest("alph_signMessage", params);
  }

  // ---------- Private ----------------------------------------------- //

  private registerEventListeners() {
    this.signer.on("connect", async () => {
      console.log(`============== CONNECT`);
      const chains = (this.signer.connection as SignerConnection).chains;
      if (chains && chains.length) this.setChain(chains);
      const accounts = (this.signer.connection as SignerConnection).accounts;
      if (accounts && accounts.length) this.setAccounts(accounts, "connect");
    });
    this.signer.connection.on(SIGNER_EVENTS.created, (session: SessionTypes.Settled) => {
      this.setChain(session.permissions.blockchain.chains);
      this.setAccounts(session.state.accounts, "created");
    });
    this.signer.connection.on(SIGNER_EVENTS.updated, (session: SessionTypes.Settled) => {
      const chain = AlephiumProvider.formatChain(this.networkId, this.chainGroup);
      if (!session.permissions.blockchain.chains.includes(chain)) {
        this.setChain(session.permissions.blockchain.chains);
      }
      console.log(`===== event update: ${session.state.accounts}`);
      this.setAccounts(session.state.accounts, "updated");
    });
    this.signer.connection.on(
      SIGNER_EVENTS.notification,
      (notification: SessionTypes.Notification) => {
        if (notification.type === providerEvents.changed.accounts) {
          console.log(`==== noti account ${JSON.stringify(notification.data)}`);
          this.setAccounts(notification.data, "noti accounts");
        } else if (notification.type === providerEvents.changed.chain) {
          console.log(`==== noti chain ${JSON.stringify(notification.data)}`);
          this.networkId = notification.data;
          this.events.emit(providerEvents.changed.chain, this.networkId);
        } else {
          this.events.emit(notification.type, notification.data);
        }
      },
    );
    this.signer.on("disconnect", () => {
      this.events.emit("disconnect");
    });
    this.events.on(providerEvents.changed.chain, networkId => this.setHttpProvider(networkId));
  }

  private setSignerProvider(client?: SignerConnectionClientOpts) {
    const connection = new SignerConnection({
      chains: [AlephiumProvider.formatChain(this.networkId, this.chainGroup)],
      methods: this.methods,
      client,
    });
    return new JsonRpcProvider(connection);
  }

  private setHttpProvider(networkId: number): JsonRpcProvider | undefined {
    const rpcUrl = getRpcUrl(networkId, this.rpc);
    if (typeof rpcUrl === "undefined") return undefined;
    const http = new JsonRpcProvider(new HttpConnection(rpcUrl));
    return http;
  }

  private isCompatibleChain(chain: string): boolean {
    return (
      chain.startsWith(`${AlephiumProvider.namespace}:`) &&
      AlephiumProvider.parseChain(chain)[1] === this.chainGroup
    );
  }

  static formatChain(networkId: number, chainGroup: number): string {
    return `${AlephiumProvider.namespace}:${networkId}-${chainGroup}`;
  }

  static parseChain(chainString: string): [number, number] {
    const [_ /* namespace */, networkId, chainGroup] = chainString.replace(/-/g, ":").split(":");
    return [Number(networkId), Number(chainGroup)];
  }

  private setChain(chains: string[]) {
    const compatible = chains.filter(x => this.isCompatibleChain(x));
    if (compatible.length) {
      [this.networkId, this.chainGroup] = AlephiumProvider.parseChain(compatible[0]);
      this.events.emit(providerEvents.changed.chain, this.networkId);
    }
  }

  static formatAccount(networkId: number, account: Account): string {
    return `${AlephiumProvider.namespace}:${networkId}-${account.group}:${account.address}-${account.pubkey}`;
  }

  static parseAccount(account: string): Account {
    const [namespace, networkId, group, address, pubkey] = account.replace(/-/g, ":").split(":");
    return {
      address: address,
      pubkey: pubkey,
      group: Number(group),
    };
  }

  private sameAccounts(account0: Account[], account1?: Account[]): boolean {
    if (typeof account1 === "undefined") {
      return false;
    } else {
      return (
        account0.map(a => AlephiumProvider.formatAccount(this.networkId, a)).join() ===
        account1.map(a => AlephiumProvider.formatAccount(this.networkId, a)).join()
      );
    }
  }

  private lastSetAccounts?: Account[];
  private setAccounts(accounts: string[], t: string) {
    const parsedAccounts = accounts.map(AlephiumProvider.parseAccount);
    if (this.sameAccounts(parsedAccounts, this.lastSetAccounts)) {
      return;
    } else {
      this.lastSetAccounts = parsedAccounts;
    }

    const newAccounts = parsedAccounts.filter(account => account.group === this.chainGroup);
    if (!this.sameAccounts(newAccounts, this.accounts)) {
      console.log(
        `===== filtered: ${t} current ${this.accounts
          .map(a => AlephiumProvider.formatAccount(this.networkId, a))
          .join()}, input ${accounts.join()}`,
      );
      this.accounts = newAccounts;
      this.events.emit(providerEvents.changed.accounts, newAccounts);
    }
  }
}

export default AlephiumProvider;
