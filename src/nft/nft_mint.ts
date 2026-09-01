/**
 * NFT STEP 3: CREATE A METAPLEX CORE ASSET ON SOLANA DEVNET
 *
 * This NFT is a Metaplex Core asset, not an SPL fungible-token mint and not a
 * Token Metadata pNFT. Core stores the asset's owner, update authority, name,
 * metadata URI, and plugins in a dedicated Core account. The image and JSON
 * remain off-chain at the URIs prepared by the earlier scripts.
 *
 * Flow: load payer/identity -> generate a new asset signer/address -> build a
 * Core `create` instruction -> sign/send/confirm -> print signature and address.
 *
 * SECURITY: this older creation script has no preview, simulation, `--send`
 * check, or typed confirmation. Running it reaches `.sendAndConfirm(umi)` and
 * creates/spends on-chain immediately. Comments do not execute that line.
 */

// Construct a Umi client for the chosen Solana RPC endpoint.
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// Umi signer/identity tools for both the wallet and new asset account.
import {
  // Wraps the wallet keypair in Umi's signer interface.
  createSignerFromKeypair,
  // Generates a new random signer/address for the Core asset account.
  generateSigner,
  // Installs the wallet signer as default identity and payer.
  signerIdentity,
} from "@metaplex-foundation/umi";

// `create` builds the Core asset instruction; `mplCore` installs Core serializers,
// programs, and helpers into Umi.
import { create, mplCore } from "@metaplex-foundation/mpl-core";

// Converts raw signature bytes into the human/explorer Base58 representation.
import { base58 } from "@metaplex-foundation/umi/serializers";

// Securely read/validate the configured Solana CLI wallet bytes.
import { loadKeypairBytes } from "../spl/utils";

// Use a caller-provided RPC when set; otherwise remain on public devnet.
const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

// Register Metaplex Core support. Without this plugin, Umi lacks the Core
// program/serializer context required by the `create` builder.
umi.use(mplCore());

// Async IIFE runs when this script is executed.
(async () => {
  try {
    // Convert validated secret bytes to a keypair. This variable contains private
    // signing power and must never be printed or committed as literal data.
    const keypair = umi.eddsa.createKeypairFromSecretKey(
      await loadKeypairBytes(),
    );

    // Make the CLI wallet the transaction payer and default authority identity.
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    // URI of the already-uploaded JSON document. The Core account stores this
    // short string and clients fetch the JSON/image separately.
    const metadataUri =
      "https://gateway.irys.xyz/8JUVH1n2xyhZbx1ofFZM7SmzkNAtxiJUNae3KW9w8WSX";

    // Generate a brand-new asset account signer. Its public key becomes the NFT's
    // unique on-chain address; it is unrelated to the SPL RAKHI mint address.
    const asset = generateSigner(umi);

    // Build the Core create instruction using this asset signer, display name,
    // and metadata URI. Property shorthand is not used for `asset` in this
    // original line: `asset: asset` explicitly maps field to variable.
    const tx = await create(umi,{
      asset: asset,
      name: "Turbin3 Cohort Admit",
      uri: metadataUri,
    // SECURITY/ON-CHAIN WRITE: this method builds, signs, submits, and waits for
    // confirmation in one call. Removing it would leave only an unsent builder.
    }).sendAndConfirm(umi);

    // The result signature is binary. `deserialize` converts it to printable
    // Base58 and `[0]` selects the decoded value from the returned tuple.
    const signature = base58.deserialize(tx.signature)[0];

    // Print public evidence: transaction signature plus unique Core asset address.
    console.log(`signature ${signature} , asset : ${asset.publicKey}`);
  } catch (e) {
    // Catch wallet/RPC/program errors. The word "errior" is only output text;
    // leaving it unchanged preserves executable behaviour for this comments-only
    // task. This older handler also does not set a non-zero process exit code.
    console.log(`errior ${e}`);
  }
// Close and invoke the immediately invoked function.
})();
