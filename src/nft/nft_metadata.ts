import {
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import {
  loadKeypairBytes,
  requireTypedConfirmation,
} from "../spl/utils";

const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

umi.use(
  irysUploader({
    address: "https://devnet.irys.xyz/",
  }),
);

(async () => {
  try {
    const image =
      "https://gateway.irys.xyz/9cZpvaBwooUErUMVjKVqQxrgAAHJVhLTJTZ3jf1XCwep";

    const metadata = {
      name: "Solana spawnpoint",
      image,
      description: "Turbin3 Cohort Admit NFT",
      category: "image",
      symbol: "T3CA",
    };

    console.log("Metadata preview:");
    console.log(JSON.stringify(metadata, null, 2));

    if (!process.argv.includes("--upload")) {
      console.log("\nPreview only. Run `npm run nft:metadata -- --upload` to upload it.");
      return;
    }

    const keypair = umi.eddsa.createKeypairFromSecretKey(
      await loadKeypairBytes(),
    );
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    await requireTypedConfirmation("UPLOAD NFT METADATA");
    const myUri = await umi.uploader.uploadJson(metadata);
    console.log(`Metadata URI: ${myUri}`);
    console.log(`Next: npm run nft:update -- ${myUri}`);
  } catch (error) {
    console.error("Metadata upload failed:", error);
    process.exitCode = 1;
  }
})();
