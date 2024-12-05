import { web3 } from "@coral-xyz/anchor";
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Sends a transaction using an Address Lookup Table for large numbers of accounts.
 */
export async function sendTransactionWithLookupTable(
  connection: Connection,
  instructions: TransactionInstruction[],
  sender: Keypair
): Promise<{ txSignature: string; lookupTableAddress: PublicKey }> {
  // Maximum number of accounts that can be added to Address Lookup Table (ALT) in a single transaction.
  const maxExtendedAccounts = 30;

  // Consolidate addresses from all instructions into a single array for the ALT.
  const lookupAddresses = Array.from(
    new Set(
      instructions.flatMap((instruction) => [
        instruction.programId,
        ...instruction.keys.map((accountMeta) => accountMeta.pubkey),
      ])
    )
  );

  // Create instructions for creating and extending the ALT.
  const [lookupTableInstruction, lookupTableAddress] = await AddressLookupTableProgram.createLookupTable({
    authority: sender.publicKey,
    payer: sender.publicKey,
    recentSlot: await connection.getSlot(),
  });

  // Submit the ALT creation transaction
  await web3.sendAndConfirmTransaction(connection, new web3.Transaction().add(lookupTableInstruction), [sender], {
    skipPreflight: true, // Avoids recent slot mismatch in simulation.
  });

  // Extend the ALT with all accounts making sure not to exceed the maximum number of accounts per transaction.
  for (let i = 0; i < lookupAddresses.length; i += maxExtendedAccounts) {
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      lookupTable: lookupTableAddress,
      authority: sender.publicKey,
      payer: sender.publicKey,
      addresses: lookupAddresses.slice(i, i + maxExtendedAccounts),
    });

    await web3.sendAndConfirmTransaction(connection, new web3.Transaction().add(extendInstruction), [sender], {
      skipPreflight: true, // Avoids recent slot mismatch in simulation.
    });
  }

  // Avoids invalid ALT index as ALT might not be active yet on the following tx.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Fetch the AddressLookupTableAccount
  const lookupTableAccount = (await connection.getAddressLookupTable(lookupTableAddress)).value;
  if (lookupTableAccount === null) throw new Error("AddressLookupTableAccount not fetched");

  // Create the versioned transaction
  const versionedTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: sender.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions,
    }).compileToV0Message([lookupTableAccount])
  );

  // Sign and submit the versioned transaction.
  versionedTx.sign([sender]);
  const txSignature = await connection.sendTransaction(versionedTx);

  return { txSignature, lookupTableAddress };
}
