/**
 * METAPLEX CORE OPERATION: TRANSFER NFT OWNERSHIP
 *
 * A Core asset stores its owner inside the existing asset account. Transferring
 * changes that owner field; it does not mint another NFT, move an SPL token, or
 * create a recipient ATA. This script deliberately keeps update authority with
 * the current CLI wallet while assigning ownership to `NEW_OWNER`.
 *
 * Owner and update authority are different permissions:
 * - owner: controls ownership actions such as transfer;
 * - update authority: controls permitted name/URI/plugin updates.
 *
 * Security: ownership transfer is a value-bearing, generally irreversible
 * action. The recipient is hard-coded, so changing that constant changes the
 * destination. The script verifies roles, simulates by default, requires
 * `--send` and typed approval, then verifies both new owner and retained update
 * authority after confirmation.
 */

// Create the Metaplex Umi client.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Wallet and public-key helpers.
import {
  // Wraps the loaded Umi keypair as a transaction signer.
  createSignerFromKeypair,
  // Validates/brands literal address strings.
  publicKey,
  // Installs a signer as default identity/payer.
  signerIdentity,
} from "@metaplex-foundation/umi";

// Base58 serialisation makes result signature bytes readable and explorer-ready.
import { base58 } from "@metaplex-foundation/umi/serializers";

// Core plugin/read/transfer helpers.
import { fetchAsset, mplCore, transfer } from "@metaplex-foundation/mpl-core";

// Shared gates and wallet loader.
import {
  hasSendApproval,
  loadKeypairBytes,
  requireTypedConfirmation,
} from "../spl/utils";

// Fixed network endpoint. Using explicit devnet avoids an accidental mainnet
// transfer caused by an environment-variable change.
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// Exact existing Core account to transfer. `publicKey` rejects malformed text.
const ASSET_ADDRESS = publicKey(
  "BAoQMWun1TB1s2K6doBdUmeKiTsQfhR9AabfVxUFshx4",
);

// Recipient wallet that should become owner. Public keys are safe to display,
// but a typo here can permanently send ownership to an unintended address.
const NEW_OWNER = publicKey(
  "DFA7MYRrMRody7RdSN8RtgyiYL96nLMuh41Eyp3KuXu5",
);

// `Promise<void>` documents that this async workflow returns no useful value.
async function main(): Promise<void> {
  // Create devnet client and immediately install Metaplex Core program support.
  const umi = createUmi(DEVNET_RPC_URL).use(mplCore());

  // Load the CLI wallet's private bytes and reconstruct a Umi keypair. Never log
  // this variable or the source bytes.
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    await loadKeypairBytes(),
  );

  // Make the wallet the transaction identity and default payer.
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  // Read the current NFT at confirmed commitment before assuming any authority.
  const asset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "confirmed",
  });

  // Only the current owner can authorise this normal Core transfer. Strict
  // inequality prevents a different CLI wallet from proceeding.
  if (asset.owner !== signer.publicKey) {
    throw new Error(
      `CLI wallet ${signer.publicKey} is not the current owner ${asset.owner}.`,
    );
  }

  // The stated plan requires the same wallet to remain address-based update
  // authority. Both the tagged variant and exact address must match.
  if (
    asset.updateAuthority.type !== "Address" ||
    asset.updateAuthority.address !== signer.publicKey
  ) {
    throw new Error(
      "The CLI wallet is not the address-based update authority; refusing to transfer under the stated authority plan.",
    );
  }

  // Reject a no-op transfer, which would spend a fee without changing owner.
  if (NEW_OWNER === asset.owner) {
    throw new Error("The recipient already owns this asset.");
  }

  // Show asset identity plus all authority roles before transaction construction.
  console.log("NFT ownership transfer summary:");
  console.log(`  Cluster:           devnet`);
  console.log(`  Asset:             ${asset.publicKey}`);
  console.log(`  Name:              ${asset.name}`);
  console.log(`  Current owner:     ${asset.owner}`);
  console.log(`  New owner:         ${NEW_OWNER}`);
  console.log(`  Payer/authority:   ${signer.publicKey}`);
  console.log(`  Update authority:  ${asset.updateAuthority.address} (unchanged)`);

  // Build the Core transfer instruction locally. No signature or write occurs.
  const transferBuilder = transfer(umi, {
    // Fetched account contains address plus current Core state/plugins.
    asset,
    // Current owner authorises transfer.
    authority: signer,
    // Same wallet pays the Solana transaction fee.
    payer: signer,
    // Only the ownership field should move to this public key.
    newOwner: NEW_OWNER,
  });

  // Build an unsigned transaction with a current blockhash for preview.
  const unsignedTransaction = await transferBuilder.buildWithLatestBlockhash(umi);

  // Non-committing simulation; unsigned preview cannot pass signature checks, so
  // verification is explicitly disabled here and only here.
  const simulation = await umi.rpc.simulateTransaction(unsignedTransaction, {
    verifySignatures: false,
  });

  // Stop before any human approval or signature when the program predicts error.
  if (simulation.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.err)}`);
  }

  // Report simulation result and optional compute usage.
  console.log(`  Simulation:        passed`);
  console.log(`  Compute units:     ${simulation.unitsConsumed ?? "not reported"}`);

  // Safe default: without the exact `--send` flag, return after simulation.
  if (!hasSendApproval()) {
    console.log(
      "\nSimulation only. Review the summary, then rerun with --send to broadcast.",
    );
    return;
  }

  // Require human acknowledgement immediately before signing/broadcast.
  await requireTypedConfirmation("TRANSFER NFT");

  // SECURITY/ON-CHAIN WRITE: Umi builds with a current blockhash, signs, submits,
  // and waits for confirmed commitment in this call.
  const result = await transferBuilder.sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });

  // Convert the binary signature result to public Base58 transaction evidence.
  const signature = base58.deserialize(result.signature)[0];
  console.log(`Transfer confirmed: ${signature}`);

  // Read post-state. `let` allows new values to replace a possibly stale first
  // RPC response during the bounded retry loop.
  let transferredAsset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "confirmed",
  });

  // Retry up to five times while confirmed RPC data has not caught up to the new
  // owner. The update authority is checked separately after owner convergence.
  for (
    let attempt = 1;
    attempt < 6 && transferredAsset.owner !== NEW_OWNER;
    attempt += 1
  ) {
    // Non-blocking 1.5-second wait between reads.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    transferredAsset = await fetchAsset(umi, ASSET_ADDRESS, {
      commitment: "confirmed",
    });
  }

  // Confirmation alone is insufficient evidence; fail if owner did not match.
  if (transferredAsset.owner !== NEW_OWNER) {
    throw new Error("Transaction confirmed, but owner verification failed.");
  }

  // Critical retained-authority check: require the Address variant and original
  // signer address. Removing this would leave the stated authority plan unproven.
  if (
    transferredAsset.updateAuthority.type !== "Address" ||
    transferredAsset.updateAuthority.address !== signer.publicKey
  ) {
    throw new Error("Ownership changed, but update-authority verification failed.");
  }

  // Print only verified new state.
  console.log(`Verified new owner: ${transferredAsset.owner}`);
  console.log(
    `Verified update authority unchanged: ${transferredAsset.updateAuthority.address}`,
  );
}

// Surface wallet/RPC/program/post-state failures and mark command failure.
main().catch((error: unknown) => {
  console.error("NFT transfer failed:", error);
  process.exitCode = 1;
});
