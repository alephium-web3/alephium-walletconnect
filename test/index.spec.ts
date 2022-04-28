import "mocha";
import { expect } from "chai";

import { SIGNER_EVENTS } from "@walletconnect/signer-connection";
import { Client, CLIENT_EVENTS } from "@walletconnect/client";
import { SessionTypes } from "@walletconnect/types";
import {
  formatJsonRpcError,
  formatJsonRpcResult,
  JsonRpcResponse,
} from "@walletconnect/jsonrpc-utils";

import AlephiumProvider, { Account } from "../src/index";
import { WalletClient } from "./shared";
import {
  groupOfAddress,
  CliqueClient,
  NodeSigner,
  PrivateKeySigner,
  convertHttpResponse,
} from "alephium-web3";
import { Balance } from "alephium-web3/api/alephium";

const NETWORK_ID = 4;
const CHAIN_GROUP = 2;
const PORT = 22973;
const RPC_URL = `http://127.0.0.1:${PORT}`;

const cliqueClient = new CliqueClient({ baseUrl: RPC_URL });
const signerA = new PrivateKeySigner(
  cliqueClient,
  "0c493c4969b89003f964401752f29af896d0aa82d751d23abc1ee59bfe85f3ec",
);
const signerB = PrivateKeySigner.createRandom(cliqueClient);
const signerC = PrivateKeySigner.createRandom(cliqueClient);
const ACCOUNTS = {
  a: {
    address: "12LgGdbjE6EtnTKw5gdBwV2RRXuXPtzYM7SDZ45YJTRht",
    privateKey: signerA.privateKey,
    group: signerA.group,
  },
  b: {
    address: signerB.address,
    privateKey: signerB.privateKey,
    group: signerB.group,
  },
  c: {
    address: signerC.address,
    privateKey: signerC.privateKey,
    group: signerC.group,
  },
};
const ONE_ALPH = "1000000000000000000";

const TEST_RELAY_URL = process.env.TEST_RELAY_URL
  ? process.env.TEST_RELAY_URL
  : "ws://localhost:5555";

const TEST_APP_METADATA = {
  name: "Test App",
  description: "Test App for WalletConnect",
  url: "https://walletconnect.com/",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};

const TEST_WALLET_METADATA = {
  name: "Test Wallet",
  description: "Test Wallet for WalletConnect",
  url: "https://walletconnect.com/",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};

const TEST_PROVIDER_OPTS = {
  networkId: NETWORK_ID,
  chainGroup: CHAIN_GROUP,
  rpc: {
    custom: {
      [NETWORK_ID]: RPC_URL,
    },
  },
  client: {
    relayUrl: TEST_RELAY_URL,
    metadata: TEST_APP_METADATA,
  },
};

const TEST_WALLET_CLIENT_OPTS = {
  networkId: NETWORK_ID,
  rpcUrl: RPC_URL,
  privateKey: ACCOUNTS.a.privateKey,
  relayUrl: TEST_RELAY_URL,
  metadata: TEST_WALLET_METADATA,
  submitTx: true,
};

const TEST_ETH_TRANSFER = {
  from: ACCOUNTS.a.address,
  to: ACCOUNTS.b.address,
  value: BigInt(1000000000000000000),
  data: "0x",
};

describe("AlephiumProvider", function() {
  this.timeout(30_000);
  cliqueClient.init(false);

  let provider: AlephiumProvider;
  let walletClient: WalletClient;
  let walletAddress: string;
  let receiverAddress: string;
  before(async () => {
    console.log(`========= START`);
    provider = new AlephiumProvider({
      ...TEST_PROVIDER_OPTS,
      chainGroup: groupOfAddress(ACCOUNTS.a.address),
    });
    walletClient = await WalletClient.init(provider, TEST_WALLET_CLIENT_OPTS);
    walletAddress = walletClient.signer.address;
    receiverAddress = ACCOUNTS.b.address;
    expect(walletAddress).to.eql(ACCOUNTS.a.address);
    const providerAccounts = await provider.connect();
    expect(providerAccounts.map(a => a.address)).to.eql([walletAddress]);
  });
  after(async () => {
    // disconnect provider
    await Promise.all([
      new Promise<void>(async resolve => {
        provider.on("disconnect", () => {
          resolve();
        });
      }),
      new Promise<void>(async resolve => {
        await walletClient.disconnect();
        resolve();
      }),
    ]);
    // expect provider to be disconnected
    expect(walletClient.client?.session.values.length).to.eql(0);
    expect(provider.connected).to.be.false;
    console.log(`========= END`);
  });
  it("chainChanged", async () => {
    // change to testnet
    console.log(
      `--------- : ${provider.accounts
        .map(a => AlephiumProvider.formatAccount(provider.networkId, a))
        .join()}`,
    );
    await Promise.all([
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeChain(1, "https://testnet-wallet.alephium.org");
          resolve();
        } catch (e) {
          reject(e);
        }
      }),

      new Promise<void>((resolve, reject) => {
        provider.on("chainChanged", chainId => {
          try {
            expect(chainId).to.eql(1);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);
    // change back to devnet
    console.log(
      `--------- : ${provider.accounts
        .map(a => AlephiumProvider.formatAccount(provider.networkId, a))
        .join()}`,
    );
    await Promise.all([
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeChain(NETWORK_ID, RPC_URL);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),

      new Promise<void>((resolve, reject) => {
        provider.on("chainChanged", chain => {
          try {
            expect(chain).to.eql(NETWORK_ID);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);
    console.log(
      `--------- : ${provider.accounts
        .map(a => AlephiumProvider.formatAccount(provider.networkId, a))
        .join()}`,
    );
  });
  it("accountsChanged", async () => {
    console.log(
      `======= ACCountsCHANGED: ${provider.accounts
        .map(a => AlephiumProvider.formatAccount(provider.networkId, a))
        .join()}`,
    );
    const changes: Account[][] = [];
    provider.on("accountsChanged", accounts => {
      console.log(`==== change ${JSON.stringify(accounts)}`);
      changes.push(accounts);
    });
    // change to account c
    await Promise.all([
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeAccount(ACCOUNTS.c.privateKey);

          resolve();
        } catch (e) {
          reject(e);
        }
      }),

      new Promise<void>((resolve, reject) => {
        provider.on("accountsChanged", accounts => {
          try {
            if (ACCOUNTS.c.group == ACCOUNTS.a.group) {
              expect(accounts[0].address).to.eql(ACCOUNTS.c.address);
            } else {
              expect(accounts).to.eql([]);
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);
    // change back to account a
    await Promise.all([
      new Promise<void>(async (resolve, reject) => {
        try {
          await walletClient.changeAccount(ACCOUNTS.a.privateKey);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),

      new Promise<void>((resolve, reject) => {
        provider.on("accountsChanged", accounts => {
          try {
            expect(accounts[0].address).to.eql(ACCOUNTS.a.address);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);
  });

  it("should sign", async () => {
    const accounts = await provider.getAccounts();
    expect(!!accounts).to.be.true;
    expect(accounts[0].address).to.eql(ACCOUNTS.a.address);

    const balance0 = await cliqueClient.getBalance(ACCOUNTS.a.address);
    console.log(balance0);
    expect(balance0.utxoNum).to.eql(1);

    expect(walletClient.submitTx).to.be.true;

    await provider.signTransferTx({
      fromPublicKey: signerA.publicKey,
      destinations: [{ address: ACCOUNTS.b.address, alphAmount: ONE_ALPH }],
    });
    const balance1 = await cliqueClient.getBalance(ACCOUNTS.a.address);
    console.log(balance1);
    expect(balance1.balance < balance0.balance).to.be.true;
  });

  // describe("Web3", () => {
  //   let web3: Web3;
  //   before(async () => {
  //     web3 = new Web3(provider);
  //   });
  //   it("matches accounts", async () => {
  //     const accounts = await web3.eth.getAccounts();
  //     expect(accounts).to.eql([walletAddress]);
  //   });
  //   it("matches chainId", async () => {
  //     const chainId = await web3.eth.getChainId();
  //     expect(chainId).to.eql(CHAIN_ID);
  //   });
  //   it("ERC20 contract", async () => {
  //     const erc20Factory = new web3.eth.Contract(JSON.parse(JSON.stringify(_abi)));
  //     const erc20 = await erc20Factory
  //       .deploy({ data: _bytecode, arguments: ["The test token", "tst", 18] })
  //       .send({ from: walletAddress });
  //     const balanceToMint = utils.parseEther("2");
  //     const mintTx = erc20.methods.mint(walletAddress, balanceToMint.toHexString());
  //     await mintTx.send({ from: walletAddress });
  //     const balance = await erc20.methods.balanceOf(walletAddress).call();
  //     expect(BigNumber.from(balance).toString()).to.eql(balanceToMint.toString());
  //     const transferTx = erc20.methods.transfer(
  //       receiverAddress,
  //       utils.parseEther("1").toHexString(),
  //     );
  //     const tokenTransferGas = await transferTx.estimateGas({ from: walletAddress });
  //     expect(tokenTransferGas.toString()).to.eql("52437");
  //     await transferTx.send({ from: walletAddress });
  //     // FIXME: balance A is still 2 after transferring 1
  //     // const tokenBalanceA = await erc20.methods.balanceOf(walletAddress).call();
  //     // expect(tokenBalanceA).to.eql(utils.parseEther("1").toString());
  //     const tokenBalanceB = await erc20.methods.balanceOf(receiverAddress).call();
  //     expect(tokenBalanceB).to.eql(utils.parseEther("1").toString());
  //   });
  //   it("estimate gas", async () => {
  //     const ethTransferGas = await web3.eth.estimateGas(TEST_ETH_TRANSFER);
  //     expect(ethTransferGas.toString()).to.eql("21001");
  //   });
  //   it("send transaction", async () => {
  //     const balanceBefore = BigNumber.from(await web3.eth.getBalance(walletAddress));
  //     await web3.eth.sendTransaction(TEST_ETH_TRANSFER);
  //     const balanceAfter = BigNumber.from(await web3.eth.getBalance(walletAddress));
  //     expect(
  //       balanceAfter.lt(balanceBefore),
  //       "balanceAfter " +
  //         balanceAfter.toString() +
  //         " less than balanceBefore: " +
  //         balanceBefore.toString(),
  //     ).to.be.true;
  //   });
  //   it("sign transaction", async () => {
  //     const balanceBefore = BigNumber.from(await web3.eth.getBalance(walletAddress));
  //     const signedTx = await web3.eth.signTransaction(TEST_ETH_TRANSFER);
  //     const broadcastTx = await provider.request({
  //       method: "eth_sendRawTransaction",
  //       params: [signedTx],
  //     });
  //     expect(!!broadcastTx).to.be.true;
  //     const balanceAfter = BigNumber.from(await web3.eth.getBalance(walletAddress));
  //     expect(balanceAfter.lt(balanceBefore)).to.be.true;
  //   });
  //   it("sign message", async () => {
  //     const msg = "Hello world";
  //     const signature = await web3.eth.sign(msg, walletAddress);
  //     const verify = utils.verifyMessage(msg, signature);
  //     expect(verify).eq(walletAddress);
  //   });
  //   it("sign transaction and send via sendAsync", async () => {
  //     const balanceBefore = BigNumber.from(await web3.eth.getBalance(walletAddress));
  //     const signedTx = await web3.eth.signTransaction(TEST_ETH_TRANSFER);
  //     const callback = async (error, result) => {
  //       expect(!!result).to.be.true;
  //       const balanceAfter = BigNumber.from(await web3.eth.getBalance(walletAddress));
  //       expect(balanceAfter.lt(balanceBefore)).to.be.true;
  //     };
  //     provider.sendAsync(
  //       {
  //         method: "eth_sendRawTransaction",
  //         params: [signedTx],
  //       },
  //       callback,
  //     );
  //   });
  // });
  // describe("methods", () => {
  //   it("matches accounts", async () => {
  //     const accounts = await provider.accounts;
  //     expect(accounts).to.eql([walletAddress]);
  //   });
  //   it("matches chainId", async () => {
  //     const networkId = await provider.networkId;
  //     expect(networkId).to.equal(NETWORK_ID);
  //   });
  //   it("ERC20 contract", async () => {
  //     const signer = web3Provider.getSigner();
  //     const erc20Factory = new ERC20Token__factory(signer as any);
  //     const erc20 = await erc20Factory.deploy("The test token", "tst", 18);
  //     await erc20.deployed();
  //     const balanceToMint = utils.parseEther("2");
  //     const mintTx = await erc20.mint(walletAddress, balanceToMint);
  //     await mintTx.wait(2);
  //     const tokenBalance = await erc20.balanceOf(walletAddress);
  //     expect(tokenBalance.toString()).to.eql(balanceToMint.toString());
  //     const tokenTransferGas = await erc20.estimateGas.transfer(
  //       receiverAddress,
  //       utils.parseEther("1"),
  //     );
  //     expect(tokenTransferGas.toString()).to.eql("52437");
  //     const transferTx = await erc20.transfer(receiverAddress, utils.parseEther("1"));
  //     await transferTx.wait(2);
  //     const tokenBalanceA = await erc20.balanceOf(walletAddress);
  //     expect(tokenBalanceA.toString()).to.eql(utils.parseEther("1").toString());
  //     const tokenBalanceB = await erc20.balanceOf(receiverAddress);
  //     expect(tokenBalanceB.toString()).to.eql(utils.parseEther("1").toString());
  //   });
  //   it("estimate gas", async () => {
  //     const ethTransferGas = await web3Provider.estimateGas(TEST_ETH_TRANSFER);
  //     // FIXME: returning 21001 instead of 21000
  //     expect(ethTransferGas.toString()).to.eql("21001");
  //   });
  //   it("send transaction", async () => {
  //     const balanceBefore = await cliqueClient.getBalance(walletAddress);

  //     provider.request()
  //     const transferTx = await signer.sendTransaction(TEST_ETH_TRANSFER);
  //     await transferTx.wait(2);

  //     expect(!!transferTx.hash).to.be.true;
  //     const balanceAfter = await web3Provider.getBalance(walletAddress);
  //     expect(
  //       balanceAfter.lt(balanceBefore),
  //       "balanceAfter " +
  //         balanceAfter.toString() +
  //         " less than balanceBefore: " +
  //         balanceBefore.toString(),
  //     ).to.be.true;
  //   });
  //   it("sign transaction", async () => {
  //     const balanceBefore = await web3Provider.getBalance(walletAddress);
  //     // FIXME: ethers does not support signTransaction but also does not resolve sendAsyncPromise
  //     // const signedTx = await signer.signTransaction(TEST_ETH_TRANSFER); // ERROR "signing transactions is unsupported (operation=\"signTransaction\", code=UNSUPPORTED_OPERATION, version=providers/5.1.0)"
  //     const signedTx = await provider.request({
  //       method: "eth_signTransaction",
  //       params: [TEST_ETH_TRANSFER],
  //     });
  //     const broadcastTx = await provider.request({
  //       method: "eth_sendRawTransaction",
  //       params: [signedTx],
  //     });
  //     expect(!!broadcastTx).to.be.true;
  //     const balanceAfter = await web3Provider.getBalance(walletAddress);
  //     expect(balanceAfter.lt(balanceBefore)).to.be.true;
  //   });
  //   it("sign message", async () => {
  //     const signer = web3Provider.getSigner();
  //     const msg = "Hello world";
  //     const signature = await signer.signMessage(msg);
  //     const verify = utils.verifyMessage(msg, signature);
  //     expect(verify).eq(walletAddress);
  //   });
  // });
});
