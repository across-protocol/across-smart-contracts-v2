import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";
import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { readProgramEvents, calculateRelayHashUint8Array } from "../../src/SvmUtils";
import { common } from "./SvmSpoke.common";
import { MerkleTree } from "@uma/common/dist/MerkleTree";
import { slowFillHashFn, SlowFillLeaf } from "./utils";

const { provider, connection, program, owner, chainId, seedBalance, initializeState } = common;
const { recipient, setCurrentTime, assertSE, assert } = common;

describe("svm_spoke.slow_fill", () => {
  anchor.setProvider(provider);
  const payer = anchor.AnchorProvider.env().wallet.payer;
  const relayer = Keypair.generate();
  const otherRelayer = Keypair.generate();

  let state: PublicKey,
    mint: PublicKey,
    relayerTA: PublicKey,
    recipientTA: PublicKey,
    otherRelayerTA: PublicKey,
    vault: PublicKey,
    fillStatus: PublicKey;

  const relayAmount = 500_000;
  let relayData: SlowFillLeaf["relayData"]; // reused relay data for all tests.
  let requestAccounts: any; // Store accounts to simplify program interactions.
  let fillAccounts: any;

  const initialMintAmount = 10_000_000_000;

  async function updateRelayData(newRelayData: SlowFillLeaf["relayData"]) {
    relayData = newRelayData;
    const relayHashUint8Array = calculateRelayHashUint8Array(relayData, chainId);
    [fillStatus] = PublicKey.findProgramAddressSync([Buffer.from("fills"), relayHashUint8Array], program.programId);

    // recipientTA could be different for each relayData if custom recipient was passed.
    recipientTA = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, relayData.recipient)).address;

    // Accounts for requestingSlowFill.
    requestAccounts = {
      state,
      signer: relayer.publicKey,
      recipient: relayData.recipient, // This could be different from global recipient.
      fillStatus,
      systemProgram: anchor.web3.SystemProgram.programId,
    };
    fillAccounts = {
      state,
      signer: relayer.publicKey,
      relayer: relayer.publicKey,
      recipient: relayData.recipient, // This could be different from global recipient.
      mintAccount: mint,
      relayerTA: relayerTA,
      recipientTA: recipientTA,
      fillStatus,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    };
  }

  const relaySlowFillRootBundle = async (slowRelayLeafRecipient = recipient) => {
    //TODO: verify that the leaf structure created here is equivalent to the one created by the EVM logic. I think
    // I've gotten the concatenation, endianness, etc correct but want to be sure.
    const slowRelayLeafs: SlowFillLeaf[] = [];
    const slowRelayLeaf: SlowFillLeaf = {
      relayData: {
        depositor: slowRelayLeafRecipient,
        recipient: slowRelayLeafRecipient,
        exclusiveRelayer: relayer.publicKey,
        inputToken: mint,
        outputToken: mint,
        inputAmount: new BN(relayAmount),
        outputAmount: new BN(relayAmount),
        originChainId: new BN(1),
        depositId: new BN(Math.floor(Math.random() * 1000000)), // Unique ID for each test.
        fillDeadline: new BN(Math.floor(Date.now() / 1000) - 30), // Note we set time in past to avoid fill deadline.
        exclusivityDeadline: new BN(Math.floor(Date.now() / 1000) - 60),
        message: Buffer.from("Test message"),
      },
      chainId,
      updatedOutputAmount: new BN(relayAmount),
    };
    await updateRelayData(slowRelayLeaf.relayData);

    slowRelayLeafs.push(slowRelayLeaf);

    const merkleTree = new MerkleTree<SlowFillLeaf>(slowRelayLeafs, slowFillHashFn);

    const slowRelayRoot = merkleTree.getRoot();
    const proof = merkleTree.getProof(slowRelayLeafs[0]);
    const leaf = slowRelayLeafs[0];

    let stateAccountData = await program.account.state.fetch(state);
    const rootBundleId = stateAccountData.rootBundleId;

    const rootBundleIdBuffer = Buffer.alloc(4);
    rootBundleIdBuffer.writeUInt32LE(rootBundleId);
    const seeds = [Buffer.from("root_bundle"), state.toBuffer(), rootBundleIdBuffer];
    const [rootBundle] = PublicKey.findProgramAddressSync(seeds, program.programId);

    const relayerRefundRoot = crypto.randomBytes(32);

    // Relay root bundle
    await program.methods
      .relayRootBundle(Array.from(relayerRefundRoot), Array.from(slowRelayRoot))
      .accounts({ state, rootBundle, signer: owner })
      .rpc();

    const proofAsNumbers = proof.map((p) => Array.from(p));
    const relayHash = calculateRelayHashUint8Array(slowRelayLeaf.relayData, chainId);

    return { relayHash, leaf, rootBundleId, proofAsNumbers, rootBundle };
  };

  before("Creates token mint and associated token accounts", async () => {
    mint = await createMint(connection, payer, owner, owner, 6);
    relayerTA = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, relayer.publicKey)).address;
    otherRelayerTA = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, otherRelayer.publicKey)).address;

    await mintTo(connection, payer, mint, relayerTA, owner, seedBalance);
    await mintTo(connection, payer, mint, otherRelayerTA, owner, seedBalance);

    await connection.requestAirdrop(relayer.publicKey, initialMintAmount); // 10 SOL
    await connection.requestAirdrop(otherRelayer.publicKey, initialMintAmount); // 10 SOL
  });

  beforeEach(async () => {
    state = await initializeState();
    vault = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, state, true)).address; // Initialize vault

    // mint mint to vault
    await mintTo(connection, payer, mint, vault, provider.publicKey, initialMintAmount);

    const initialVaultBalance = (await connection.getTokenAccountBalance(vault)).value.amount;
    assert.strictEqual(
      BigInt(initialVaultBalance),
      BigInt(initialMintAmount),
      "Initial vault balance should be equal to the minted amount"
    );

    const initialRelayData = {
      depositor: recipient,
      recipient: recipient,
      exclusiveRelayer: relayer.publicKey,
      inputToken: mint, // This is lazy. it should be an encoded token from a separate domain most likely.
      outputToken: mint,
      inputAmount: new BN(relayAmount),
      outputAmount: new BN(relayAmount),
      originChainId: new BN(1),
      depositId: new BN(1),
      fillDeadline: new BN(Math.floor(Date.now() / 1000) + 60), // 1 minute from now
      exclusivityDeadline: new BN(Math.floor(Date.now() / 1000) + 30), // 30 seconds from now
      message: Buffer.from("Test message"),
    };

    await updateRelayData(initialRelayData);
  });

  it("Requests a V3 slow fill, verify the event & state change", async () => {
    // Attempt to request a slow fill before the fillDeadline
    const relayHash = calculateRelayHashUint8Array(relayData, chainId);
    try {
      await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();
      assert.fail("Request should have failed due to fill deadline not passed");
    } catch (err) {
      assert.include(err.toString(), "WithinFillWindow", "Expected WithinFillWindow error");
    }

    // Set the contract time to be after the fillDeadline
    await setCurrentTime(program, state, relayer, relayData.fillDeadline.add(new BN(1)));

    await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();

    // Fetch and verify the RequestedV3SlowFill event
    await new Promise((resolve) => setTimeout(resolve, 500));
    const events = await readProgramEvents(connection, program);
    const event = events.find((event) => event.name === "requestedV3SlowFill").data;
    assert.isNotNull(event, "RequestedV3SlowFill event should be emitted");

    // Verify that the event data matches the relay data.
    Object.keys(relayData).forEach((key) => {
      assertSE(event[key], relayData[key], `${key.charAt(0).toUpperCase() + key.slice(1)} should match`);
    });
  });

  it("Fails to request a V3 slow fill if the relay has already been filled", async () => {
    const relayHash = calculateRelayHashUint8Array(relayData, chainId);

    // Fill the relay first
    await program.methods.fillV3Relay(relayHash, relayData, new BN(1)).accounts(fillAccounts).signers([relayer]).rpc();

    try {
      await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();
      assert.fail("Request should have failed due to being within exclusivity window");
    } catch (err) {
      assert.include(err.toString(), "WithinFillWindow", "Expected WithinFillWindow error");
    }

    // Set the contract time to be after the fillDeadline.
    await setCurrentTime(program, state, relayer, relayData.fillDeadline.add(new BN(1)));

    // Attempt to request a slow fill after the relay has been filled.
    try {
      await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();
      assert.fail("Request should have failed due to relay already being filled");
    } catch (err) {
      assert.include(err.toString(), "InvalidSlowFillRequest", "Expected InvalidSlowFillRequest error");
    }
  });

  it("Fetches FillStatusAccount before and after requestV3SlowFill", async () => {
    const relayHash = calculateRelayHashUint8Array(relayData, chainId);
    const [fillStatusPDA] = PublicKey.findProgramAddressSync([Buffer.from("fills"), relayHash], program.programId);

    // Fetch FillStatusAccount before requestV3SlowFill
    let fillStatusAccount = await program.account.fillStatusAccount.fetchNullable(fillStatusPDA);
    assert.isNull(fillStatusAccount, "FillStatusAccount should be uninitialized before requestV3SlowFill");

    // Set the contract time to be after the fillDeadline
    await setCurrentTime(program, state, relayer, relayData.fillDeadline.add(new BN(1)));

    // Request a slow fill
    await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();

    // Fetch FillStatusAccount after requestV3SlowFill
    fillStatusAccount = await program.account.fillStatusAccount.fetch(fillStatusPDA);
    assert.isNotNull(fillStatusAccount, "FillStatusAccount should be initialized after requestV3SlowFill");
    assert.equal(
      JSON.stringify(fillStatusAccount.status),
      `{\"requestedSlowFill\":{}}`,
      "FillStatus should be RequestedSlowFill"
    );
    assert.equal(fillStatusAccount.relayer.toString(), relayer.publicKey.toString(), "Caller should be set as relayer");
  });

  it("Fails to request a V3 slow fill multiple times for the same fill", async () => {
    const relayHash = calculateRelayHashUint8Array(relayData, chainId);

    // Set the contract time to be after the fillDeadline
    await setCurrentTime(program, state, relayer, relayData.fillDeadline.add(new BN(1)));

    // Request a slow fill
    await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();

    // Attempt to request a slow fill again for the same relay
    try {
      await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();
      assert.fail("Request should have failed due to relay already being requested for slow fill");
    } catch (err) {
      assert.include(err.toString(), "InvalidSlowFillRequest", "Expected InvalidSlowFillRequest error");
    }
  });

  it("Executes V3 slow relay leaf", async () => {
    // Relay root bundle with slow fill leaf.
    const { relayHash, leaf, rootBundleId, proofAsNumbers, rootBundle } = await relaySlowFillRootBundle();

    const iVaultBal = (await connection.getTokenAccountBalance(vault)).value.amount;
    const iRecipientBal = (await connection.getTokenAccountBalance(recipientTA)).value.amount;

    // Attempt to execute V3 slow relay leaf before requesting slow fill. This should fail before requested,
    // even if there is a valid proof.
    try {
      await program.methods
        .executeV3SlowRelayLeaf(relayHash, leaf, rootBundleId, proofAsNumbers)
        .accounts({
          state: state,
          rootBundle: rootBundle,
          signer: owner,
          fillStatus: requestAccounts.fillStatus,
          vault: vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          mint: mint,
          recipient,
          recipientTokenAccount: recipientTA,
        })
        .rpc();
      assert.fail("Execution should have failed due to fill status account not being initialized");
    } catch (err) {
      assert.include(err.toString(), "AccountNotInitialized", "Expected AccountNotInitialized error");
    }

    // Request V3 slow fill
    await program.methods
      .requestV3SlowFill(relayHash, leaf.relayData)
      .accounts(requestAccounts)
      .signers([relayer])
      .rpc();

    // Execute V3 slow relay leaf after requesting slow fill
    await program.methods
      .executeV3SlowRelayLeaf(relayHash, leaf, rootBundleId, proofAsNumbers)
      .accounts({
        state: state,
        rootBundle,
        signer: owner,
        fillStatus: requestAccounts.fillStatus,
        vault: vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: mint,
        recipient,
        recipientTokenAccount: recipientTA,
      })
      .rpc();

    // Verify the results
    const fVaultBal = (await connection.getTokenAccountBalance(vault)).value.amount;
    const fRecipientBal = (await connection.getTokenAccountBalance(recipientTA)).value.amount;

    assert.strictEqual(
      BigInt(iVaultBal) - BigInt(fVaultBal),
      BigInt(leaf.updatedOutputAmount.toNumber()),
      "Vault balance should be reduced by relay amount"
    );
    assert.strictEqual(
      BigInt(fRecipientBal) - BigInt(iRecipientBal),
      BigInt(leaf.updatedOutputAmount.toNumber()),
      "Recipient balance should be increased by relay amount"
    );
  });

  it("Fails to request a V3 slow fill when fills are paused", async () => {
    // Pause fills
    await program.methods.pauseFills(true).accounts({ state, signer: owner }).rpc();
    const stateAccountData = await program.account.state.fetch(state);
    assert.isTrue(stateAccountData.pausedFills, "Fills should be paused");

    // Set the contract time to be after the fillDeadline
    await setCurrentTime(program, state, relayer, relayData.fillDeadline.add(new BN(1)));

    // Attempt to request a slow fill. This should fail because fills are paused.
    try {
      const relayHash = calculateRelayHashUint8Array(relayData, chainId);
      await program.methods.requestV3SlowFill(relayHash, relayData).accounts(requestAccounts).signers([relayer]).rpc();
      assert.fail("Request should have failed due to fills being paused");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.strictEqual(err.error.errorCode.code, "FillsArePaused", "Expected error code FillsArePaused");
    }
  });

  it("Fails to execute V3 slow relay leaf to wrong recipient", async () => {
    // Request V3 slow fill.
    const { relayHash, leaf, rootBundleId, proofAsNumbers, rootBundle } = await relaySlowFillRootBundle();
    await program.methods
      .requestV3SlowFill(relayHash, leaf.relayData)
      .accounts(requestAccounts)
      .signers([relayer])
      .rpc();

    // Try to execute V3 slow relay leaf with wrong recipient should fail.
    const wrongRecipient = Keypair.generate().publicKey;
    const wrongRecipientTA = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, wrongRecipient)).address;
    try {
      await program.methods
        .executeV3SlowRelayLeaf(relayHash, leaf, rootBundleId, proofAsNumbers)
        .accounts({
          state: state,
          rootBundle,
          signer: owner,
          fillStatus: requestAccounts.fillStatus,
          vault: vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          mint: mint,
          recipient: wrongRecipient,
          recipientTokenAccount: wrongRecipientTA,
        })
        .rpc();
      assert.fail("Execution should have failed due to wrong recipient");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.strictEqual(err.error.errorCode.code, "InvalidFillRecipient", "Expected error code InvalidFillRecipient");
    }
  });

  it("Cannot replay execute V3 slow relay leaf against wrong fill status account", async () => {
    // Request V3 slow fill for the first recipient.
    const firstRecipient = Keypair.generate().publicKey;
    const {
      relayHash: firstRelayHash,
      leaf: firstLeaf,
      rootBundleId: firstRootBundleId,
      proofAsNumbers: firstProofAsNumbers,
      rootBundle: firstRootBundle,
    } = await relaySlowFillRootBundle(firstRecipient);
    await program.methods
      .requestV3SlowFill(firstRelayHash, firstLeaf.relayData)
      .accounts(requestAccounts)
      .signers([relayer])
      .rpc();
    const firstRecipientTA = recipientTA; // Global recipientTA will get updated when passing the second relayData.
    const firstFillStatus = fillStatus; // Global fillStatus will get updated when passing the second relayData.

    // Request V3 slow fill for the second recipient.
    // Note: we could also had generated single slow relay root for both recipients, but having them relayed in separate
    // root bundles makes it easier to reuse existing test code.
    const secondRecipient = Keypair.generate().publicKey;
    const { relayHash: secondRelayHash, leaf: secondLeaf } = await relaySlowFillRootBundle(secondRecipient);
    await program.methods
      .requestV3SlowFill(secondRelayHash, secondLeaf.relayData)
      .accounts(requestAccounts)
      .signers([relayer])
      .rpc();
    const secondFillStatus = fillStatus; // Global fillStatus got updated with the second relayData.

    const iFirstRecipientBal = (await connection.getTokenAccountBalance(firstRecipientTA)).value.amount;
    // Execute V3 slow relay leaf for the first recipient.
    await program.methods
      .executeV3SlowRelayLeaf(firstRelayHash, firstLeaf, firstRootBundleId, firstProofAsNumbers)
      .accounts({
        state,
        firstRootBundle,
        signer: owner,
        fillStatus: firstFillStatus,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint,
        recipient: firstRecipient,
        recipientTokenAccount: firstRecipientTA,
      })
      .rpc();
    const fFirstRecipientBal = (await connection.getTokenAccountBalance(firstRecipientTA)).value.amount;
    assert.strictEqual(
      BigInt(fFirstRecipientBal) - BigInt(iFirstRecipientBal),
      BigInt(firstLeaf.updatedOutputAmount.toString()),
      "First recipient balance should be increased by its relay amount"
    );

    // Try to replay execute V3 slow relay leaf for the first recipient using the fill status account that is derived
    // from the second relay hash. This should fail due to mismatching relay hash.
    try {
      await program.methods
        .executeV3SlowRelayLeaf(secondRelayHash, firstLeaf, firstRootBundleId, firstProofAsNumbers)
        .accounts({
          state,
          firstRootBundle,
          signer: owner,
          fillStatus: secondFillStatus,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          mint,
          recipient: firstRecipient,
          recipientTokenAccount: firstRecipientTA,
        })
        .rpc();
      assert.fail("Execution should have failed due to wrong fill status account");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.strictEqual(err.error.errorCode.code, "InvalidRelayHash", "Expected error code InvalidRelayHash");
    }
  });

  it("Fails to execute V3 slow relay leaf for mint inconsistent output_token", async () => {
    // Request V3 slow fill.
    const { relayHash, leaf, rootBundleId, proofAsNumbers, rootBundle } = await relaySlowFillRootBundle();
    await program.methods
      .requestV3SlowFill(relayHash, leaf.relayData)
      .accounts(requestAccounts)
      .signers([relayer])
      .rpc();

    // Create and fund new accounts as derived from wrong mint account.
    const wrongMint = await createMint(connection, payer, owner, owner, 6);
    const wrongRecipientTA = (await getOrCreateAssociatedTokenAccount(connection, payer, wrongMint, recipient)).address;
    const wrongVault = (await getOrCreateAssociatedTokenAccount(connection, payer, wrongMint, state, true)).address;
    await mintTo(connection, payer, wrongMint, wrongVault, provider.publicKey, initialMintAmount);

    // Try to execute V3 slow relay leaf with inconsistent mint should fail.
    try {
      await program.methods
        .executeV3SlowRelayLeaf(relayHash, leaf, rootBundleId, proofAsNumbers)
        .accounts({
          state,
          rootBundle,
          signer: owner,
          fillStatus: requestAccounts.fillStatus,
          vault: wrongVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          mint: wrongMint,
          recipient,
          recipientTokenAccount: wrongRecipientTA,
        })
        .rpc();
      assert.fail("Execution should have failed for inconsistent mint");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.strictEqual(err.error.errorCode.code, "InvalidMint", "Expected error code InvalidMint");
    }
  });
});