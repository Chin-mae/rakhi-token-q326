/**
 * METAPLEX CORE OPERATION: UPDATE AN EXISTING NFT'S NAME AND METADATA URI
 *
 * Updating does not create a second NFT. It changes fields in the same Core
 * asset account at `ASSET_ADDRESS`. Ownership and update authority are separate:
 * this operation needs the update authority, while ownership can later move to
 * another wallet without automatically moving update authority.
 *
 * Data flow:
 * command-line URI -> HTTPS/JSON validation -> current asset/authority check ->
 * local transaction builder -> simulation -> optional approval/send -> RPC
 * polling -> verified final name and URI.
 *
 * Security: remote metadata is untrusted input. This script requires HTTPS and
 * checks the JSON's expected name/image shape before building a state change.
 * It simulates by default and signs only after `--send` plus typed confirmation.
 */

// Creates the Umi client that coordinates RPC, programs, and plugins.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Wallet/public-key helpers used by the client and authority checks.
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";

// Serialiser used to print raw result signatures as Base58 text.
import { base58 } from "@metaplex-foundation/umi/serializers";

// Core helpers: read an asset, install Core support, and build an update.
import { fetchAsset, mplCore, update } from "@metaplex-foundation/mpl-core";

// Shared input, approval, wallet, and typed-confirmation helpers.
import {
  getPositionalArguments,
  hasSendApproval,
  loadKeypairBytes,
  requireTypedConfirmation,
} from "../spl/utils";

// Explicit devnet endpoint prevents this script from silently targeting mainnet.
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// `publicKey(...)` validates/brands this Base58 text as the exact Core asset to
// update. A different address would target a different NFT.
const ASSET_ADDRESS = publicKey(
  "BAoQMWun1TB1s2K6doBdUmeKiTsQfhR9AabfVxUFshx4",
);

// Required on-chain name after update and required `name` inside remote JSON.
const NEW_NAME = "Solana spawnpoint";

// A TypeScript object type for only the remote fields this validator examines.
// `?` means a property may be absent, and `unknown` prevents trusting its type
// before runtime checks. This type disappears from emitted JavaScript.
type MetadataJson = {
  name?: unknown;
  image?: unknown;
};

/** Parse and validate the required metadata URI from command-line input. */
function getMetadataUri(): string {
  // Index `[0]` selects the first non-flag positional argument.
  const metadataUri = getPositionalArguments()[0];

  // Stop with usage guidance when it is empty/undefined.
  if (!metadataUri) {
    throw new Error(
      "Missing metadata URI. Run: npm run nft:update -- <metadata-uri>",
    );
  }

  // The built-in URL constructor rejects malformed URI text and exposes parsed
  // components such as the protocol. It may throw, which reaches top-level catch.
  const parsed = new URL(metadataUri);

  // Strictly allow encrypted HTTPS retrieval. HTTP metadata could be modified in
  // transit and point users to content different from what was reviewed.
  if (parsed.protocol !== "https:") {
    throw new Error("The metadata URI must use HTTPS.");
  }

  // Return only after presence, syntax, and protocol checks pass.
  return metadataUri;
}

/** Download untrusted JSON and verify the fields this project requires.
 * `Promise<void>` means asynchronous success returns no data; failure throws.
 */
async function validateMetadata(metadataUri: string): Promise<void> {
  // Node's `fetch` performs an external HTTPS GET request. It does not write to
  // Solana, but the response must still be considered attacker-controlled.
  const response = await fetch(metadataUri);

  // `ok` covers HTTP success codes. Network success with 404/500 is not valid.
  if (!response.ok) {
    throw new Error(`Metadata request failed with HTTP ${response.status}.`);
  }

  // Parse JSON, then assert only the minimal compile-time shape. The subsequent
  // runtime checks are still essential because `as` does not validate data.
  const metadata = (await response.json()) as MetadataJson;

  // Require exact name equality between off-chain document and on-chain update.
  if (metadata.name !== NEW_NAME) {
    throw new Error(`Metadata name must be exactly "${NEW_NAME}".`);
  }

  // `typeof` proves the image is text; `||` rejects either wrong type or a value
  // that does not begin with HTTPS. Short-circuiting avoids calling startsWith on
  // a non-string value.
  if (typeof metadata.image !== "string" || !metadata.image.startsWith("https://")) {
    throw new Error("Metadata must contain an HTTPS image URI.");
  }
}

// Complete asynchronous update workflow.
async function main(): Promise<void> {
  // Validate user input before wallet access or transaction construction.
  const metadataUri = getMetadataUri();

  // Create a devnet Umi client and chain `.use(mplCore())` to install Core
  // program/serializer support in the returned client.
  const umi = createUmi(DEVNET_RPC_URL).use(mplCore());

  // Load private key bytes, reconstruct the keypair, wrap it as a Umi signer,
  // then install it as payer/identity. Never print the keypair or raw bytes.
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    await loadKeypairBytes(),
  );
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  // Read the current Core account. This is a network read, not a mutation.
  const asset = await fetchAsset(umi, ASSET_ADDRESS);

  // Core update authority is a tagged value. First require the `Address` variant,
  // then require that address to equal the CLI wallet's public key.
  if (
    asset.updateAuthority.type !== "Address" ||
    asset.updateAuthority.address !== signer.publicKey
  ) {
    throw new Error(
      `CLI wallet ${signer.publicKey} is not the asset update authority.`,
    );
  }

  // Validate the exact remote document before letting its URI enter the update.
  await validateMetadata(metadataUri);

  // Print old/new state and authority roles for human review.
  console.log("NFT update summary:");
  console.log(`  Cluster:          devnet`);
  console.log(`  Asset:            ${asset.publicKey}`);
  console.log(`  Payer/authority:  ${signer.publicKey}`);
  console.log(`  Old name:         ${asset.name}`);
  console.log(`  New name:         ${NEW_NAME}`);
  console.log(`  Old metadata URI: ${asset.uri}`);
  console.log(`  New metadata URI: ${metadataUri}`);

  // Build a local Core update description. This does not send yet.
  const updateBuilder = update(umi, {
    // Passing fetched `asset` supplies its address/current account context.
    asset,
    // This signer must match the checked update authority.
    authority: signer,
    // Replace the Core account's name and URI with reviewed values.
    name: NEW_NAME,
    uri: metadataUri,
  });

  // Build an unsigned transaction with a current lifetime for simulation.
  const unsignedTransaction = await updateBuilder.buildWithLatestBlockhash(umi);

  // Execute a non-committing RPC simulation. Signature verification is disabled
  // because this preview transaction is intentionally unsigned.
  const simulation = await umi.rpc.simulateTransaction(unsignedTransaction, {
    verifySignatures: false,
  });

  // A program/RPC simulation error prevents approval and broadcast.
  if (simulation.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.err)}`);
  }

  // `??` uses readable fallback text if the RPC omits compute usage.
  console.log(`  Simulation:       passed`);
  console.log(`  Compute units:    ${simulation.unitsConsumed ?? "not reported"}`);

  // Safe default: without explicit `--send`, stop after summary + simulation.
  if (!hasSendApproval()) {
    console.log(
      "\nSimulation only. Review the summary, then rerun with --send to broadcast.",
    );
    return;
  }

  // Last human gate before the wallet signs an on-chain mutation.
  await requireTypedConfirmation("UPDATE NFT");

  // SECURITY/ON-CHAIN WRITE: build, sign, submit, and wait for confirmed status.
  const result = await updateBuilder.sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });

  // Convert byte signature to human-readable Base58 transaction ID.
  const signature = base58.deserialize(result.signature)[0];
  console.log(`Update confirmed: ${signature}`);

  // Read back current state. `let` permits replacing it during bounded retries.
  let updatedAsset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "confirmed",
  });

  // Poll up to five times while either name or URI is stale. RPC replication can
  // lag briefly even after transaction confirmation.
  for (
    let attempt = 1;
    attempt < 6 &&
    (updatedAsset.name !== NEW_NAME || updatedAsset.uri !== metadataUri);
    attempt += 1
  ) {
    // Non-blocking 1.5-second delay before another network read.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    updatedAsset = await fetchAsset(umi, ASSET_ADDRESS, {
      commitment: "confirmed",
    });
  }

  // Do not equate confirmation with correct intent; independently compare the
  // final account fields after retries.
  if (updatedAsset.name !== NEW_NAME || updatedAsset.uri !== metadataUri) {
    throw new Error("Transaction confirmed, but post-update verification failed.");
  }

  // Success output runs only after verified post-state matches both fields.
  console.log(`Verified asset: ${updatedAsset.publicKey}`);
}

// Handle any rejected Promise, preserve context, and mark shell/CI failure.
main().catch((error: unknown) => {
  console.error("NFT update failed:", error);
  process.exitCode = 1;
});
