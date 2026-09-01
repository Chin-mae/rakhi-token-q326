/**
 * NFT STEP 2: BUILD AND OPTIONALLY UPLOAD OFF-CHAIN METADATA JSON
 *
 * This script creates a normal JavaScript object describing the NFT. The object
 * contains the public image URI produced by `nft_image.ts`, plus name,
 * description, category, and symbol. By default it only previews the JSON.
 * With `--upload`, it asks for typed approval, uploads the JSON to Irys, and
 * prints a metadata URI for an NFT create/update instruction.
 *
 * This file still does not create or mutate the on-chain Core asset. It prepares
 * the off-chain document that the asset's on-chain `uri` field will reference.
 * Anyone can fetch public Irys data, so metadata must never contain secrets.
 */

// Umi signer helpers connect the CLI wallet to Metaplex operations.
import {
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";

// Ready-made Umi client constructor.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Adds JSON/file upload methods backed by Irys.
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";

// Shared wallet loader and human confirmation gate.
import {
  loadKeypairBytes,
  requireTypedConfirmation,
} from "../spl/utils";

// Prefer an explicit environment RPC, otherwise use Solana public devnet.
const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

// Configure Umi's uploader to use Irys devnet.
umi.use(
  irysUploader({
    address: "https://devnet.irys.xyz/",
  }),
);

// Async IIFE: define and immediately run the complete preview/upload workflow.
(async () => {
  try {
    // Public URI returned by the image-upload step. This is text, not the image
    // bytes themselves; clients later follow the URL to render the image.
    const image =
      "https://gateway.irys.xyz/9cZpvaBwooUErUMVjKVqQxrgAAHJVhLTJTZ3jf1XCwep";

    // JavaScript object whose property names become JSON keys. `const` prevents
    // the object variable from being reassigned while building the preview.
    const metadata = {
      // Display name inside the off-chain document.
      name: "Solana spawnpoint",
      // Property shorthand: `image` means `image: image` using the URI above.
      image,
      // Longer human-readable explanation.
      description: "Turbin3 Cohort Admit NFT",
      // Helps clients understand the media/category convention.
      category: "image",
      // Short display symbol; Core uniqueness still comes from asset address.
      symbol: "T3CA",
    };

    // Preview the exact object before any key loading or paid upload.
    console.log("Metadata preview:");

    // JSON.stringify converts the object to JSON text. `null` means no custom
    // replacer, and `2` indents nested output by two spaces for readability.
    console.log(JSON.stringify(metadata, null, 2));

    // `process.argv` contains command-line words. Unless `--upload` is present,
    // the leading `!` makes this branch return safely after preview.
    if (!process.argv.includes("--upload")) {
      // `\n` inserts a blank line in terminal output; backticks allow literal
      // command punctuation without affecting execution.
      console.log("\nPreview only. Run `npm run nft:metadata -- --upload` to upload it.");
      return;
    }

    // Paid path begins here. Load private bytes, construct a Umi keypair, wrap it
    // as a signer, and install it as identity. Never log `keypair` or its bytes.
    const keypair = umi.eddsa.createKeypairFromSecretKey(
      await loadKeypairBytes(),
    );
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    // Ask for an exact acknowledgement immediately before the external upload.
    await requireTypedConfirmation("UPLOAD NFT METADATA");

    // SECURITY/EXTERNAL WRITE: serialise and upload public JSON to Irys. The
    // returned URI should be treated as immutable content location/evidence.
    const myUri = await umi.uploader.uploadJson(metadata);

    // Print public output and the next intended command. These lines do not
    // themselves update an NFT.
    console.log(`Metadata URI: ${myUri}`);
    console.log(`Next: npm run nft:update -- ${myUri}`);
  } catch (error) {
    // Include context, preserve the underlying error, and signal command failure.
    console.error("Metadata upload failed:", error);
    process.exitCode = 1;
  }
// Close and immediately invoke the async function expression.
})();
