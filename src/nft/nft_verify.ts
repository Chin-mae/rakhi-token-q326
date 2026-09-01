/**
 * READ-ONLY METAPLEX CORE NFT VERIFICATION
 *
 * This script independently checks two kinds of evidence:
 * 1. finalized current asset state (name, URI, owner, update authority), and
 * 2. finalized success statuses for the known update/transfer signatures.
 *
 * It never loads a wallet, signs, pays a fee, or writes to Solana. `finalized`
 * commitment is stronger/slower than `confirmed`: the cluster has rooted the
 * relevant state so it is appropriate for durable assignment evidence.
 *
 * The optional stage argument (`update`, `transfer`, or `all`) controls which
 * historical signatures are checked and displayed; current asset invariants are
 * checked in every mode.
 */

// Construct the Umi RPC/client framework.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Validate literal Base58 address strings into Umi public-key values.
import { publicKey } from "@metaplex-foundation/umi";

// Signature-status RPC expects byte form; the Base58 serializer converts known
// human-readable transaction IDs back into those bytes.
import { base58 } from "@metaplex-foundation/umi/serializers";

// Install Core support and fetch/deserialize its asset account.
import { fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";

// Fixed devnet read endpoint.
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// Exact Core account whose state this evidence script verifies.
const ASSET_ADDRESS = publicKey(
  "BAoQMWun1TB1s2K6doBdUmeKiTsQfhR9AabfVxUFshx4",
);

// Wallet that must retain permission to update name/URI after ownership moves.
const UPDATE_AUTHORITY = publicKey(
  "GzxbTnfFevizoZChrcG5RtKBZw3THEEXBgcbiGNUHapJ",
);

// Wallet that must currently own the NFT after the transfer.
const CURRENT_OWNER = publicKey(
  "DFA7MYRrMRody7RdSN8RtgyiYL96nLMuh41Eyp3KuXu5",
);

// Expected final human-readable name stored in the Core account.
const CURRENT_NAME = "Solana spawnpoint";

// Expected final off-chain JSON pointer stored in the Core account.
const CURRENT_METADATA_URI =
  "https://gateway.irys.xyz/ApgZVZ1AQj7HndT2TENsdVjHadeDtiPcYFaLn2tP3JHo";

// Historical transaction proof for the metadata/name update.
const UPDATE_SIGNATURE =
  "xMynVy2nBVycvtp5CuSw4452pi8W7jviJPgMvYP5vccEHg2sdKwcZcuiwgWMjVpAYBYMPkbB63BfWmxPfabTpzu";

// Historical transaction proof for the ownership transfer.
const TRANSFER_SIGNATURE =
  "KWraJtdrzV5UbvHYaUzFT1rBm3sWRDHkLkZ7UNW6hZDukBAtLmwHpvQHKvWQu4ZND9iDjxgKneocwUq4WU7tJWM";

// String-literal union: TypeScript permits exactly these three stage values and
// rejects arbitrary strings at compile time after runtime validation.
type VerificationStage = "update" | "transfer" | "all";

/** Parse and validate the optional verification mode. */
function getStage(): VerificationStage {
  // `process.argv[2]` is the first user argument. `?? "all"` defaults only when
  // it is missing/null, so running without a stage checks both signatures.
  const stage = process.argv[2] ?? "all";

  // Every `!==` asks whether a value differs; `&&` requires all three differences
  // before rejecting, meaning any one valid choice is accepted.
  if (stage !== "update" && stage !== "transfer" && stage !== "all") {
    throw new Error("Stage must be update, transfer, or all.");
  }

  // Runtime validation above narrows `stage` to `VerificationStage`.
  return stage;
}

// Perform the read-only network checks and print evidence.
async function main(): Promise<void> {
  // Choose signature scope before making RPC calls.
  const stage = getStage();

  // Create the devnet Umi client and add Core codecs/program knowledge.
  const umi = createUmi(DEVNET_RPC_URL).use(mplCore());

  // Fetch the durable current Core account using finalized commitment.
  const asset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "finalized",
  });

  // One compound invariant validates all current-state claims. `||` means any
  // mismatch makes the complete statement fail.
  if (
    // Expected display name...
    asset.name !== CURRENT_NAME ||
    // expected off-chain JSON pointer...
    asset.uri !== CURRENT_METADATA_URI ||
    // expected post-transfer owner...
    asset.owner !== CURRENT_OWNER ||
    // expected address-based authority representation...
    asset.updateAuthority.type !== "Address" ||
    // and expected retained update-authority wallet.
    asset.updateAuthority.address !== UPDATE_AUTHORITY
  ) {
    throw new Error("The finalized Core asset state does not match expectations.");
  }

  // Build an ordered list containing only signatures requested by `stage`.
  // `...` spreads either a one-item array or an empty array into the result.
  const requestedSignatures = [
    ...(stage === "update" || stage === "all" ? [UPDATE_SIGNATURE] : []),
    ...(stage === "transfer" || stage === "all" ? [TRANSFER_SIGNATURE] : []),
  ];

  // Convert each Base58 string to bytes with `.map`, then request all statuses in
  // one RPC call. History search is necessary for older finalized transactions.
  const statuses = await umi.rpc.getSignatureStatuses(
    requestedSignatures.map((signature) => base58.serialize(signature)),
    { searchTransactionHistory: true },
  );

  // `for...of` visits each returned status. `.entries()` pairs every item with
  // its numeric index so an error can name the matching requested signature.
  for (const [index, status] of statuses.entries()) {
    // Reject missing status, execution error, or anything below finalized. The
    // short-circuit `||` chain safely avoids reading fields from a missing value.
    if (!status || status.error || status.commitment !== "finalized") {
      throw new Error(
        `Transaction verification failed for ${requestedSignatures[index]}.`,
      );
    }
  }

  // Header separates verified evidence from routine command output.
  console.log("METAPLEX CORE NFT — LIVE DEVNET VERIFICATION");
  console.log("================================================");

  // Print current finalized state read directly from the Core account.
  console.log(`Asset:            ${asset.publicKey}`);
  console.log(`Current name:     ${asset.name}`);
  console.log(`Metadata URI:     ${asset.uri}`);
  console.log(`Current owner:    ${asset.owner}`);
  console.log(`Update authority: ${asset.updateAuthority.address}`);

  // Track which returned status corresponds to the next selected section. `let`
  // is required because the value may be incremented after the update section.
  let statusIndex = 0;

  // Logical OR displays update evidence for either update-only or all mode.
  if (stage === "update" || stage === "all") {
    // Select the status aligned with UPDATE_SIGNATURE.
    const status = statuses[statusIndex];

    // Move index forward so transfer reads the following status in all mode.
    statusIndex += 1;

    // `\n` starts the section after a blank line.
    console.log("\nNFT UPDATE");
    console.log(`Signature:         ${UPDATE_SIGNATURE}`);

    // Optional chaining `?.` returns undefined rather than throwing if a value
    // is missing; the earlier validation means it should be present here.
    console.log(`Status:            ${status?.commitment}`);

    // Nullish fallback prints "none" only for a missing/null error field.
    console.log(`Transaction error: ${status?.error ?? "none"}`);

    // Current state lines connect historical successful update with final data.
    console.log(`Verified name:     ${asset.name}`);
    console.log(`Verified URI:      ${asset.uri}`);
    console.log(`Update authority:  ${asset.updateAuthority.address}`);
    console.log("Result:            UPDATE VERIFIED");
  }

  // Display transfer evidence in transfer-only or all mode.
  if (stage === "transfer" || stage === "all") {
    // In transfer-only mode index is 0; in all mode the update branch made it 1.
    const status = statuses[statusIndex];
    console.log("\nNFT OWNERSHIP TRANSFER");
    console.log(`Signature:         ${TRANSFER_SIGNATURE}`);
    console.log(`Status:            ${status?.commitment}`);
    console.log(`Transaction error: ${status?.error ?? "none"}`);

    // Prove transfer changed owner while update authority remained separate.
    console.log(`Verified owner:    ${asset.owner}`);
    console.log(`Update authority:  ${asset.updateAuthority.address}`);
    console.log("Result:            TRANSFER VERIFIED");
  }
}

// Handle bad stage values, RPC failures, mismatches, or failed signatures.
main().catch((error: unknown) => {
  console.error(
    "NFT verification failed:",
    // Print Error.message when available; otherwise safely stringify unknown.
    error instanceof Error ? error.message : String(error),
  );

  // Non-zero exit status lets CI/shell scripts distinguish failure from success.
  process.exitCode = 1;
});
