import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { readFile } from "fs/promises";
import { loadKeypairBytes } from "../spl/utils";

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
    const keypair = umi.eddsa.createKeypairFromSecretKey(
      await loadKeypairBytes(),
    );
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    //chanege image path to your image path
    const image = await readFile("src/nft/Turbin3_cohort_admit.jpg");

    //change the image name and mime type
    const file = createGenericFile(image, "Turbin3_cohort_admit.jpg", {
      contentType: "image/jpeg",
    });

    const [myUri] = await umi.uploader.upload([file]);

    console.log("Your image URI: ", myUri);
  } catch (error) {
    console.log(error);
  }
})();
