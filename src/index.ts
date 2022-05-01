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
  SignerProvider,
  Account,
  GetAccountsResult,
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
  groupOfAddress,
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

interface SignerMethodsTable extends Record<SignerMethods, { params: any; result: any }> {
  alph_getAccounts: {
    params: undefined;
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
    network: "networkChanged",
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

export interface WalletConnectProviderOptions {
  networkId: number;
  chainGroup: number;
  methods?: string[];
  rpc?: AlephiumRpcConfig;
  client?: SignerConnectionClientOpts;
}

class WalletConnectProvider implements SignerProvider {
  public events: any = new EventEmitter();

  public static namespace = "alephium";
  public networkId: number;
  public chainGroup: number;
  public methods = signerMethods;

  public accounts: Account[] = [];

  public signer: JsonRpcProvider;

  get permittedChain(): string {
    return formatChain(this.networkId, this.chainGroup);
  }

  constructor(opts: WalletConnectProviderOptions) {
    this.networkId = opts.networkId;
    this.chainGroup = opts.chainGroup;
    this.methods = opts.methods ? [...opts.methods, ...this.methods] : this.methods;
    this.signer = this.setSignerProvider(opts.client);
    this.registerEventListeners();
  }

  // The provider only supports signer methods. The other requests should use Alephium Rest API.
  public async request<T = unknown>(args: RequestArguments): Promise<T> {
    if (args.method === "alph_getAccounts") {
      return this.accounts as any;
    }
    if (this.methods.includes(args.method)) {
      const signerAddress = args.params?.signerAddress;
      if (typeof signerAddress === "undefined") {
        throw new Error("Cannot request without signerAddress");
      }
      const signerAccount = this.accounts.find(
        account => account.address === args.params.signerAddress,
      );
      if (typeof signerAccount === "undefined") {
        throw new Error(`Unknown signer address ${args.params.signerAddress}`);
      }
      return this.signer.request(args, {
        chainId: formatChain(this.networkId, signerAccount.group),
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
      const chain = formatChain(this.networkId, this.chainGroup);
      if (!session.permissions.blockchain.chains.includes(chain)) {
        this.setChain(session.permissions.blockchain.chains);
      }
      this.setAccounts(session.state.accounts);
    });
    this.signer.connection.on(
      SIGNER_EVENTS.notification,
      (notification: SessionTypes.Notification) => {
        if (notification.type === providerEvents.changed.accounts) {
          this.setAccounts(notification.data);
        } else if (notification.type === providerEvents.changed.network) {
          this.networkId = notification.data;
          this.events.emit(providerEvents.changed.network, this.networkId);
        } else {
          this.events.emit(notification.type, notification.data);
        }
      },
    );
    this.signer.on("disconnect", () => {
      this.events.emit("disconnect");
    });
  }

  private setSignerProvider(client?: SignerConnectionClientOpts) {
    const connection = new SignerConnection({
      chains: [formatChain(this.networkId, this.chainGroup)],
      methods: this.methods,
      client,
    });
    return new JsonRpcProvider(connection);
  }

  private sameChains(chains0: string[], chains1?: string[]): boolean {
    if (typeof chains1 === "undefined") {
      return false;
    } else {
      return chains0.join() === chains1.join();
    }
  }

  private lastSetChains?: string[];
  private setChain(chains: string[]) {
    if (this.sameChains(chains, this.lastSetChains)) {
      return;
    } else {
      this.lastSetChains = chains;
    }

    const compatible = chains.filter(x => isCompatibleChain(x));
    if (compatible.length) {
      [this.networkId, this.chainGroup] = parseChain(compatible[0]);
      this.events.emit(providerEvents.changed.network, this.networkId);
    }
  }

  private sameAccounts(account0: Account[], account1?: Account[]): boolean {
    if (typeof account1 === "undefined") {
      return false;
    } else {
      return (
        account0.map(a => formatAccount(this.permittedChain, a)).join() ===
        account1.map(a => formatAccount(this.permittedChain, a)).join()
      );
    }
  }

  private lastSetAccounts?: Account[];
  private setAccounts(accounts: string[]) {
    const parsedAccounts = accounts.map(parseAccount);
    if (this.sameAccounts(parsedAccounts, this.lastSetAccounts)) {
      return;
    } else {
      this.lastSetAccounts = parsedAccounts;
    }

    const newAccounts = parsedAccounts.filter(account =>
      isCompatibleChainGroup(this.chainGroup, account.group),
    );
    if (!this.sameAccounts(newAccounts, this.accounts)) {
      this.accounts = newAccounts;
      this.events.emit(providerEvents.changed.accounts, newAccounts);
    }
  }
}

export function isCompatibleChain(chain: string): boolean {
  return chain.startsWith(`${WalletConnectProvider.namespace}:`);
}

export function formatChain(networkId: number, chainGroup: number): string {
  return `${WalletConnectProvider.namespace}:${networkId}/${chainGroup}`;
}

export function isCompatibleChainGroup(expectedChainGroup: number, chainGroup: number): boolean {
  return expectedChainGroup === -1 || expectedChainGroup === chainGroup;
}

export function upgradeChainGroup(permittedChainGroup: number, chainGroup: number): number {
  if (permittedChainGroup === -1) {
    return -1;
  } else {
    return chainGroup;
  }
}

export function parseChain(chainString: string): [number, number] {
  const [_ /* namespace */, networkId, chainGroup] = chainString.replace(/\//g, ":").split(":");
  return [Number(networkId), Number(chainGroup)];
}

export function formatAccount(permittedChain: string, account: Account): string {
  return `${permittedChain}:${account.address}+${account.pubkey}`;
}

export function parseAccount(account: string): Account {
  const [namespace, permittedChain, address, pubkey] = account.replace(/\+/g, ":").split(":");
  return {
    address: address,
    pubkey: pubkey,
    group: groupOfAddress(address),
  };
}

export default WalletConnectProvider;
