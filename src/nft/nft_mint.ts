import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { create, mplCore } from "@metaplex-foundation/mpl-core";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { loadKeypairBytes } from "../spl/utils";

const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

umi.use(mplCore());

(async () => {
  try {
    const keypair = umi.eddsa.createKeypairFromSecretKey(
      await loadKeypairBytes(),
    );
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    const metadataUri =
      "https://gateway.irys.xyz/8JUVH1n2xyhZbx1ofFZM7SmzkNAtxiJUNae3KW9w8WSX";
    const asset = generateSigner(umi);

    //add you nft name and metadata uri
    const tx = await create(umi,{
      asset: asset,
      name: "Turbin3 Cohort Admit",
      uri: metadataUri,
    }).sendAndConfirm(umi);

    const signature = base58.deserialize(tx.signature)[0];

    console.log(`signature ${signature} , asset : ${asset.publicKey}`);
  } catch (e) {
    console.log(`errior ${e}`);
  }
})();
