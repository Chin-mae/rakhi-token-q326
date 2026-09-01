/**
 * NFT STEP 1: UPLOAD THE LOCAL IMAGE TO IRYS
 *
 * A Metaplex Core asset cannot store a full JPEG economically inside its
 * on-chain account. This script reads the JPEG from this repository, wraps its
 * bytes with a filename/MIME type, uploads it to Irys storage, and prints the
 * resulting public URI. `nft_metadata.ts` places that image URI inside JSON.
 *
 * Important separation:
 * - `readFile(...)` is a local filesystem read.
 * - `createGenericFile(...)` prepares data in memory.
 * - `umi.uploader.upload(...)` is the external, potentially paid upload.
 * - Nothing in this file creates an NFT on Solana.
 *
 * SECURITY: this script has no preview flag or typed-confirmation gate. Merely
 * running it reaches the upload call and uses the configured wallet identity;
 * an Irys upload can spend devnet funds. Opening/commenting the file does not.
 */

// Create a Umi client, Metaplex's framework for RPC, signers, and plugins.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Named Umi utilities prepare a generic file and adapt the wallet into a signer.
import {
  // Combines raw bytes with filename and MIME-type metadata.
  createGenericFile,
  // Gives a Umi keypair the Signer interface used by plugins.
  createSignerFromKeypair,
  // Installs the signer as Umi's default identity/payer.
  signerIdentity,
} from "@metaplex-foundation/umi";

// Irys uploader plugin supplies persistent off-chain file-upload behaviour.
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";

// Promise-based Node filesystem reader allows asynchronous `await readFile(...)`.
import { readFile } from "fs/promises";

// Reuse the validated Solana CLI wallet loader. `..` goes up from `nft` to
// `src`, then `spl/utils` selects the sibling helper file.
import { loadKeypairBytes } from "../spl/utils";

// Build the Umi client for an environment-provided RPC URL when available.
// `??` falls back to public devnet only when the variable is null/undefined.
const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

// `.use` installs the Irys upload implementation into the Umi client.
umi.use(
  irysUploader({
    // Explicit devnet Irys endpoint keeps this educational upload off mainnet.
    address: "https://devnet.irys.xyz/",
  }),
);

// This is an Immediately Invoked Async Function Expression (async IIFE):
// `async () => { ... }` defines an unnamed async function and the final `()`
// runs it as soon as the script starts. Removing `()` would define but not run it.
(async () => {
  // `try` sends any thrown/rejected error to the matching `catch` block.
  try {
    // Reconstruct the keypair from validated secret bytes. Never print this
    // variable: it contains private signing material.
    const keypair = umi.eddsa.createKeypairFromSecretKey(
      await loadKeypairBytes(),
    );

    // Adapt the keypair and install it as the uploader identity/payer.
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    // Read the named image as raw bytes. The relative path is resolved from the
    // directory where the command is run; without the file, `readFile` rejects.
    const image = await readFile("src/nft/Turbin3_cohort_admit.jpg");

    // Wrap bytes in Umi's file representation. The public filename and MIME type
    // tell storage/gateways and browsers how the bytes should be interpreted.
    const file = createGenericFile(image, "Turbin3_cohort_admit.jpg", {
      // JPEG's standard internet media type. A wrong type can cause bad display.
      contentType: "image/jpeg",
    });

    // SECURITY/EXTERNAL WRITE: upload an array containing one file. The method
    // returns an array of URIs in matching order; `[myUri]` takes the first URI.
    const [myUri] = await umi.uploader.upload([file]);

    // Print only the public URI, never the wallet/keypair. Copy this output into
    // the `image` field used by `nft_metadata.ts`.
    console.log("Your image URI: ", myUri);
  } catch (error) {
    // Handles filesystem, wallet, RPC, funding, or upload failures. This older
    // script logs the full unknown value and does not set a non-zero exit code.
    console.log(error);
  }
// `})();` closes the function body, invokes it, and ends the statement.
})();
