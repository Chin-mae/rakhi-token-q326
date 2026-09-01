/**
 * STEP 2 OF THE SPL FLOW: CREATE METAPLEX TOKEN METADATA
 *
 * A mint account stores token mechanics such as supply, decimals, and
 * authorities; it does not store a rich name, symbol, description, or image.
 * This script creates a separate Metaplex Token Metadata account derived from
 * the mint address. That account stores the display name/symbol and a URI that
 * points to off-chain JSON.
 *
 * This is metadata for the fungible RAKHI mint. It is not the Metaplex Core NFT
 * created by `src/nft/nft_mint.ts`; the two workflows use different on-chain
 * programs and account models.
 *
 * Security: creating metadata spends devnet SOL and the chosen update authority
 * can change mutable metadata later. The script previews, simulates, asks for a
 * typed phrase, refreshes the blockhash, signs, broadcasts, and confirms.
 */

// Umi is Metaplex's client framework. These imports turn the wallet keypair into
// a Umi signer, validate public-key text, and install that signer as identity.
import {
  // Wraps a Umi keypair with signing methods.
  createSignerFromKeypair,
  // Converts/validates address text as a Umi public key.
  publicKey,
  // Plugin that makes a signer the default identity and payer.
  signerIdentity,
} from "@metaplex-foundation/umi";

// Creates a ready-to-configure Umi client for the selected RPC endpoint.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Metaplex Token Metadata supplies the instruction and compile-time object
// shapes used to create the mint's metadata account.
import {
  // Builds the V3 create-metadata transaction instruction.
  createMetadataAccountV3,
  // `type` imports disappear from JavaScript; they only make TypeScript verify
  // that required account roles are supplied correctly.
  type CreateMetadataAccountV3InstructionAccounts,
  type CreateMetadataAccountV3InstructionArgs,
  // Describes the name/symbol/URI and optional royalty-related fields.
  type DataV2Args,
} from "@metaplex-foundation/mpl-token-metadata";

// Solana signatures are bytes on the wire; bs58 makes them printable in the
// familiar explorer-compatible Base58 form.
import bs58 from "bs58";

// Shared project settings keep this script aligned with the mint definition.
import {
  CLUSTER,
  RPC_URL,
  TOKEN_METADATA_URI,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from "./config";

// Shared helpers validate input, load the approved wallet, and gate sending.
import {
  getRequiredAddressArgument,
  hasSendApproval,
  loadKeypairBytes,
  requireTypedConfirmation,
} from "./utils";

// `async` is required because wallet, RPC, simulation, signing, and confirmation
// operations return Promises that are consumed with `await`.
async function main() {
  // Read positional argument 0 as the existing mint address. Without a valid
  // mint, metadata could be attached to the wrong token or construction fails.
  const mintAddress = getRequiredAddressArgument("mint", 0);

  // Default to an entirely non-signing plan. `!` negates the approval result.
  if (!hasSendApproval()) {
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");

    // Template literals insert the exact values that would be used later.
    console.log(`Step: create Metaplex metadata for ${mintAddress}`);
    console.log(`Cluster: ${CLUSTER}`);
    console.log(`Name: ${TOKEN_NAME}`);
    console.log(`Symbol: ${TOKEN_SYMBOL}`);
    console.log(`Metadata URI: ${TOKEN_METADATA_URI}`);

    // Mutable metadata can later be updated by the update authority. This is a
    // governance/security property, not merely a presentation preference.
    console.log("Metadata update authority: your signer (metadata remains mutable)");
    console.log("Run again with --send only after reviewing the transaction summary.");

    // Stop before reading private key bytes or constructing a transaction.
    return;
  }

  // Establish the Metaplex client connection. This creates a local object; no
  // chain write happens until `sendTransaction` below.
  const umi = createUmi(RPC_URL);

  // Read validated 64-byte key material and let Umi reconstruct the keypair.
  // Never log `keypair` because it contains signing power/private material.
  const keypair = umi.eddsa.createKeypairFromSecretKey(await loadKeypairBytes());

  // Adapt that keypair to Umi's Signer interface.
  const signer = createSignerFromKeypair(umi, keypair);

  // `.use(...)` installs a plugin; here the wallet becomes default identity and
  // payer for Metaplex builders.
  umi.use(signerIdentity(signer));

  // Convert the already-validated Kit address representation to Umi's public-key
  // representation. It refers to the mint created by `spl_init.ts`.
  const mint = publicKey(mintAddress);

  // A typed object maps required on-chain roles to addresses/signers.
  const accounts: CreateMetadataAccountV3InstructionAccounts = {
    // Metadata will be deterministically associated with this mint.
    mint,
    // The current mint authority must approve creation of its metadata account.
    mintAuthority: signer,
  };

  // This object is the actual metadata payload written to the metadata account.
  const data: DataV2Args = {
    // Display fields come from central configuration.
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    // The chain stores this URL; clients fetch the JSON at that URL separately.
    uri: TOKEN_METADATA_URI,
    // Basis points divide one percent into 100 parts. Zero means no seller fee.
    sellerFeeBasisPoints: 0,
    // `null` explicitly says no verified creator array is configured.
    creators: null,
    // This fungible token is not assigned to an NFT collection here.
    collection: null,
    // No limited-use/redemption configuration is attached.
    uses: null,
  };

  // Instruction arguments combine payload plus account-level metadata rules.
  const args: CreateMetadataAccountV3InstructionArgs = {
    // Property shorthand `data` means `data: data`.
    data,
    // `true` leaves the metadata changeable by its update authority.
    isMutable: true,
    // No collection-sized metadata details are required for this token.
    collectionDetails: null,
  };

  // Print roles and mutable/fee decisions before simulation or approval.
  console.log("Transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer, mint authority, update authority: ${signer.publicKey}`);
  console.log(`Mint: ${mint}`);
  console.log(`Name / symbol: ${TOKEN_NAME} / ${TOKEN_SYMBOL}`);
  console.log(`Metadata URI: ${TOKEN_METADATA_URI}`);
  console.log("Seller fee: 0% | Metadata mutable: yes");

  // Request a recent blockhash. The returned object also includes its last valid
  // block height, so it can later be used as a confirmation strategy.
  const latestBlockhash = await umi.rpc.getLatestBlockhash({
    commitment: "confirmed",
  });

  // `...accounts` and `...args` spread every property into one options object.
  // The builder describes the transaction locally; `.setBlockhash` attaches its
  // current lifetime but still does not sign or broadcast anything.
  const transactionBuilder = createMetadataAccountV3(umi, {
    ...accounts,
    ...args,
  }).setBlockhash(latestBlockhash);

  // Build an unsigned transaction specifically for safe preflight simulation.
  const unsignedTransaction = transactionBuilder.build(umi);

  // Ask the RPC node to execute the proposed transaction without committing it.
  const simulation = await umi.rpc.simulateTransaction(unsignedTransaction, {
    commitment: "confirmed",
    // This is intentionally unsigned at the preview stage.
    verifySignatures: false,
    // Public RPC nodes may reject an old builder blockhash; replacement lets the
    // simulator substitute a current one without changing the real transaction.
    replaceRecentBlockhash: true,
  });

  // An error means the real transaction is not safe/valid enough to continue.
  if (simulation.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.err)}`);
  }

  // `??` supplies readable fallback text when the RPC omits compute-unit data.
  console.log(
    `Simulation succeeded. Compute units: ${simulation.unitsConsumed ?? "not reported"}`,
  );

  // Require deliberate human approval after seeing the exact summary/simulation.
  await requireTypedConfirmation("CREATE RAKHI METADATA");

  // Refresh immediately before signing to reduce blockhash-expiry failures.
  const freshBlockhash = await umi.rpc.getLatestBlockhash({
    commitment: "confirmed",
  });

  // Builders are immutable-style values: this returns a version using the new
  // blockhash rather than relying on the old simulated lifetime.
  const transactionBuilderWithFreshBlockhash =
    transactionBuilder.setBlockhash(freshBlockhash);

  // Build exact wire instructions and apply required cryptographic signatures.
  const signedTransaction =
    await transactionBuilderWithFreshBlockhash.buildAndSign(umi);

  // SECURITY: this is the state-changing network broadcast. Preflight stays on
  // (`skipPreflight: false`) so RPC performs its own final safety simulation.
  const signature = await umi.rpc.sendTransaction(signedTransaction, {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });

  // Wait until the submitted signature is observed at confirmed commitment.
  // Spreading `freshBlockhash` supplies blockhash and last-valid-block-height.
  const confirmation = await umi.rpc.confirmTransaction(signature, {
    commitment: "confirmed",
    strategy: { type: "blockhash", ...freshBlockhash },
  });

  // Confirmation can return successfully while reporting an on-chain program
  // error; this explicit check prevents false success messages.
  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  // Convert the raw signature bytes into explorer-readable Base58 text.
  // Buffer.from provides the byte container expected by the bs58 package.
  const encodedSignature = bs58.encode(Buffer.from(signature));
  console.log(`Metadata transaction signature: ${encodedSignature}`);

  // Print a network-qualified explorer link for independent inspection.
  console.log(
    `Explorer: https://explorer.solana.com/tx/${encodedSignature}?cluster=${CLUSTER}`,
  );
}

// Run the async entry point and make any rejection visible to people and CI.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
