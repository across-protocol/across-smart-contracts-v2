import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { MerkleTree } from "@uma/common/dist/MerkleTree";
import { common } from "./SvmSpoke.common";
import { MessageTransmitter } from "../../target/types/message_transmitter";
import { TokenMessengerMinter } from "../../target/types/token_messenger_minter";
import { RelayerRefundLeafSolana, RelayerRefundLeafType, relayerRefundHashFn, findProgramAddress } from "./utils";
import { assert } from "chai";
import { decodeMessageSentData } from "./cctpHelpers";

const { provider, program, owner, initializeState, connection, remoteDomain, chainId, crossDomainAdmin } = common;

describe("svm_spoke.token_bridge", () => {
  anchor.setProvider(provider);

  const tokenMessengerMinterProgram = anchor.workspace.TokenMessengerMinter as anchor.Program<TokenMessengerMinter>;
  const messageTransmitterProgram = anchor.workspace.MessageTransmitter as anchor.Program<MessageTransmitter>;

  let state: PublicKey,
    mint: PublicKey,
    vault: PublicKey,
    tokenMinter: PublicKey,
    messageTransmitter: PublicKey,
    tokenMessenger: PublicKey,
    remoteTokenMessenger: PublicKey,
    eventAuthority: PublicKey,
    transferLiability: PublicKey,
    localToken: PublicKey,
    tokenMessengerMinterSenderAuthority: PublicKey;

  let messageSentEventData: anchor.web3.Keypair; // This will hold CCTP message data.

  let bridgeTokensToHubPoolAccounts: any;

  const payer = (anchor.AnchorProvider.env().wallet as anchor.Wallet).payer;

  const initialMintAmount = 10_000_000_000;

  before(async () => {
    // token_minter state is pulled from devnet (DBD8hAwLDRQkTsu6EqviaYNGKPnsAMmQonxf7AH8ZcFY) with its
    // token_controller field overridden to test wallet.
    tokenMinter = findProgramAddress("token_minter", tokenMessengerMinterProgram.programId).publicKey;

    // message_transmitter state is forked from devnet (BWrwSWjbikT3H7qHAkUEbLmwDQoB4ZDJ4wcSEhSPTZCu).
    messageTransmitter = findProgramAddress("message_transmitter", messageTransmitterProgram.programId).publicKey;

    // token_messenger state is forked from devnet (Afgq3BHEfCE7d78D2XE9Bfyu2ieDqvE24xX8KDwreBms).
    tokenMessenger = findProgramAddress("token_messenger", tokenMessengerMinterProgram.programId).publicKey;

    // Ethereum remote_token_messenger state is forked from devnet (Hazwi3jFQtLKc2ughi7HFXPkpDeso7DQaMR9Ks4afh3j).
    remoteTokenMessenger = findProgramAddress("remote_token_messenger", tokenMessengerMinterProgram.programId, [
      remoteDomain.toString(),
    ]).publicKey;

    // PDA for token_messenger_minter to emit DepositForBurn event via CPI.
    eventAuthority = findProgramAddress("__event_authority", tokenMessengerMinterProgram.programId).publicKey;

    // PDA, used to check that CCTP sendMessage was called by TokenMessenger
    tokenMessengerMinterSenderAuthority = findProgramAddress(
      "sender_authority",
      tokenMessengerMinterProgram.programId
    ).publicKey;
  });

  beforeEach(async () => {
    // Each test will have different state and mint token.
    state = await initializeState();
    mint = await createMint(connection, payer, owner, owner, 6);
    vault = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, state, true)).address;

    await mintTo(connection, payer, mint, vault, provider.publicKey, initialMintAmount);

    transferLiability = findProgramAddress("transfer_liability", program.programId, [mint]).publicKey;
    localToken = findProgramAddress("local_token", tokenMessengerMinterProgram.programId, [mint]).publicKey;

    // add local cctp token
    const custodyTokenAccount = findProgramAddress("custody", tokenMessengerMinterProgram.programId, [mint]).publicKey;
    await tokenMessengerMinterProgram.methods
      .addLocalToken({})
      .accounts({
        tokenController: owner,
        tokenMinter,
        localToken,
        custodyTokenAccount,
        localTokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // set max burn amount per CCTP message for local token to total mint amount.
    await tokenMessengerMinterProgram.methods
      .setMaxBurnAmountPerMessage({ burnLimitPerMessage: new anchor.BN(initialMintAmount) })
      .accounts({
        tokenMinter,
        localToken,
      })
      .rpc();

    // Populate accounts for bridgeTokensToHubPool.
    messageSentEventData = anchor.web3.Keypair.generate();
    bridgeTokensToHubPoolAccounts = {
      payer: owner,
      mint,
      state,
      transferLiability,
      vault,
      tokenMessengerMinterSenderAuthority,
      messageTransmitter,
      tokenMessenger,
      remoteTokenMessenger,
      tokenMinter,
      localToken,
      messageSentEventData: messageSentEventData.publicKey,
      messageTransmitterProgram: messageTransmitterProgram.programId,
      tokenMessengerMinterProgram: tokenMessengerMinterProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      eventAuthority,
    };
  });

  const initializeBridgeToHubPool = async (amountToReturn: number) => {
    // Prepare root bundle with a single leaf containing amount to bridge to the HubPool.
    const relayerRefundLeaves: RelayerRefundLeafType[] = [];
    relayerRefundLeaves.push({
      isSolana: true,
      leafId: new anchor.BN(0),
      chainId,
      amountToReturn: new anchor.BN(amountToReturn),
      mintPublicKey: mint,
      refundAccounts: [],
      refundAmounts: [],
    });
    const merkleTree = new MerkleTree<RelayerRefundLeafType>(relayerRefundLeaves, relayerRefundHashFn);
    const root = merkleTree.getRoot();
    const proof = merkleTree.getProof(relayerRefundLeaves[0]);
    const leaf = relayerRefundLeaves[0] as RelayerRefundLeafSolana;
    const stateAccountData = await program.account.state.fetch(state);
    const rootBundleId = stateAccountData.rootBundleId;
    const rootBundleIdBuffer = Buffer.alloc(4);
    rootBundleIdBuffer.writeUInt32LE(rootBundleId);
    const seeds = [Buffer.from("root_bundle"), state.toBuffer(), rootBundleIdBuffer];
    const [rootBundle] = PublicKey.findProgramAddressSync(seeds, program.programId);

    // Relay root bundle
    await program.methods
      .relayRootBundle(Array.from(root), Array.from(Buffer.alloc(32)))
      .accounts({ state, rootBundle, signer: owner })
      .rpc();

    // Execute relayer refund leaf.
    const proofAsNumbers = proof.map((p) => Array.from(p));
    await program.methods
      .executeRelayerRefundLeaf(stateAccountData.rootBundleId, leaf, proofAsNumbers)
      .accounts({
        state,
        rootBundle,
        signer: owner,
        vault,
        mint,
        transferLiability,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  };

  it("Bridge all pending tokens to HubPool in single transaction", async () => {
    const pendingToHubPool = 1_000_000;

    await initializeBridgeToHubPool(pendingToHubPool);

    const initialVaultBalance = (await connection.getTokenAccountBalance(vault)).value.amount;
    assert.strictEqual(initialVaultBalance, initialMintAmount.toString());

    await program.methods
      .bridgeTokensToHubPool(new anchor.BN(pendingToHubPool))
      .accounts(bridgeTokensToHubPoolAccounts)
      .signers([messageSentEventData])
      .rpc();

    const finalVaultBalance = (await connection.getTokenAccountBalance(vault)).value.amount;
    assert.strictEqual(finalVaultBalance, (initialMintAmount - pendingToHubPool).toString());

    const finalPendingToHubPool = (await program.account.transferLiability.fetch(transferLiability)).pendingToHubPool;
    assert.isTrue(finalPendingToHubPool.isZero(), "Invalid pending to HubPool amount");

    const message = decodeMessageSentData(
      (await messageTransmitterProgram.account.messageSent.fetch(messageSentEventData.publicKey)).message
    );
    assert.strictEqual(message.destinationDomain, remoteDomain, "Invalid destination domain");
    assert.isTrue(message.messageBody.burnToken.equals(mint), "Invalid burn token");
    assert.isTrue(message.messageBody.mintRecipient.equals(crossDomainAdmin), "Invalid mint recipient");
    assert.strictEqual(message.messageBody.amount.toString(), pendingToHubPool.toString(), "Invalid amount");
  });

  it("Bridge above pending tokens in single transaction to HubPool should fail", async () => {
    const pendingToHubPool = 1_000_000;
    const bridgeAmount = pendingToHubPool + 1;

    await initializeBridgeToHubPool(pendingToHubPool);

    try {
      await program.methods
        .bridgeTokensToHubPool(new anchor.BN(bridgeAmount))
        .accounts(bridgeTokensToHubPoolAccounts)
        .signers([messageSentEventData])
        .rpc();
      assert.fail("Should not be able to bridge above pending tokens to HubPool");
    } catch (error) {
      assert.instanceOf(error, anchor.AnchorError);
      assert.strictEqual(
        error.error.errorCode.code,
        "ExceededPendingBridgeAmount",
        "Expected error code ExceededPendingBridgeAmount"
      );
    }
  });

  it("Bridge pending tokens to HubPool in multiple transactions", async () => {
    const pendingToHubPool = 10_000_000;
    const singleBridgeAmount = pendingToHubPool / 5;

    await initializeBridgeToHubPool(pendingToHubPool);

    const initialVaultBalance = (await connection.getTokenAccountBalance(vault)).value.amount;
    assert.strictEqual(initialVaultBalance, initialMintAmount.toString());

    for (let i = 0; i < 5; i++) {
      const loopMessageSentEventData = anchor.web3.Keypair.generate();

      await program.methods
        .bridgeTokensToHubPool(new anchor.BN(singleBridgeAmount))
        .accounts({ ...bridgeTokensToHubPoolAccounts, messageSentEventData: loopMessageSentEventData.publicKey })
        .signers([loopMessageSentEventData])
        .rpc();
    }

    const finalVaultBalance = (await connection.getTokenAccountBalance(vault)).value.amount;
    assert.strictEqual(finalVaultBalance, (initialMintAmount - pendingToHubPool).toString());

    const finalPendingToHubPool = (await program.account.transferLiability.fetch(transferLiability)).pendingToHubPool;
    assert.isTrue(finalPendingToHubPool.isZero(), "Invalid pending to HubPool amount");
  });

  it("Bridge above pending tokens in multiple transactions to HubPool should fail", async () => {
    const pendingToHubPool = 10_000_000;
    const singleBridgeAmount = pendingToHubPool / 5;

    await initializeBridgeToHubPool(pendingToHubPool);

    const initialVaultBalance = (await connection.getTokenAccountBalance(vault)).value.amount;
    assert.strictEqual(initialVaultBalance, initialMintAmount.toString());

    // Bridge out first 4 tranches.
    for (let i = 0; i < 4; i++) {
      const loopMessageSentEventData = anchor.web3.Keypair.generate();

      await program.methods
        .bridgeTokensToHubPool(new anchor.BN(singleBridgeAmount))
        .accounts({ ...bridgeTokensToHubPoolAccounts, messageSentEventData: loopMessageSentEventData.publicKey })
        .signers([loopMessageSentEventData])
        .rpc();
    }

    // Try to bridge out more tokens in the final tranche.
    try {
      await program.methods
        .bridgeTokensToHubPool(new anchor.BN(singleBridgeAmount + 1))
        .accounts(bridgeTokensToHubPoolAccounts)
        .signers([messageSentEventData])
        .rpc();
      assert.fail("Should not be able to bridge above pending tokens to HubPool");
    } catch (error) {
      assert.instanceOf(error, anchor.AnchorError);
      assert.strictEqual(
        error.error.errorCode.code,
        "ExceededPendingBridgeAmount",
        "Expected error code ExceededPendingBridgeAmount"
      );
    }
  });
});
