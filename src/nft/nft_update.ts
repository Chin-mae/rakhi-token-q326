import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { fetchAsset, mplCore, update } from "@metaplex-foundation/mpl-core";
import {
  getPositionalArguments,
  hasSendApproval,
  loadKeypairBytes,
  requireTypedConfirmation,
} from "../spl/utils";

const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const ASSET_ADDRESS = publicKey(
  "BAoQMWun1TB1s2K6doBdUmeKiTsQfhR9AabfVxUFshx4",
);
const NEW_NAME = "Solana spawnpoint";

type MetadataJson = {
  name?: unknown;
  image?: unknown;
};

function getMetadataUri(): string {
  const metadataUri = getPositionalArguments()[0];
  if (!metadataUri) {
    throw new Error(
      "Missing metadata URI. Run: npm run nft:update -- <metadata-uri>",
    );
  }

  const parsed = new URL(metadataUri);
  if (parsed.protocol !== "https:") {
    throw new Error("The metadata URI must use HTTPS.");
  }

  return metadataUri;
}

async function validateMetadata(metadataUri: string): Promise<void> {
  const response = await fetch(metadataUri);
  if (!response.ok) {
    throw new Error(`Metadata request failed with HTTP ${response.status}.`);
  }

  const metadata = (await response.json()) as MetadataJson;
  if (metadata.name !== NEW_NAME) {
    throw new Error(`Metadata name must be exactly "${NEW_NAME}".`);
  }
  if (typeof metadata.image !== "string" || !metadata.image.startsWith("https://")) {
    throw new Error("Metadata must contain an HTTPS image URI.");
  }
}

async function main(): Promise<void> {
  const metadataUri = getMetadataUri();
  const umi = createUmi(DEVNET_RPC_URL).use(mplCore());

  const keypair = umi.eddsa.createKeypairFromSecretKey(
    await loadKeypairBytes(),
  );
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  const asset = await fetchAsset(umi, ASSET_ADDRESS);
  if (
    asset.updateAuthority.type !== "Address" ||
    asset.updateAuthority.address !== signer.publicKey
  ) {
    throw new Error(
      `CLI wallet ${signer.publicKey} is not the asset update authority.`,
    );
  }

  await validateMetadata(metadataUri);

  console.log("NFT update summary:");
  console.log(`  Cluster:          devnet`);
  console.log(`  Asset:            ${asset.publicKey}`);
  console.log(`  Payer/authority:  ${signer.publicKey}`);
  console.log(`  Old name:         ${asset.name}`);
  console.log(`  New name:         ${NEW_NAME}`);
  console.log(`  Old metadata URI: ${asset.uri}`);
  console.log(`  New metadata URI: ${metadataUri}`);

  const updateBuilder = update(umi, {
    asset,
    authority: signer,
    name: NEW_NAME,
    uri: metadataUri,
  });

  const unsignedTransaction = await updateBuilder.buildWithLatestBlockhash(umi);
  const simulation = await umi.rpc.simulateTransaction(unsignedTransaction, {
    verifySignatures: false,
  });
  if (simulation.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.err)}`);
  }

  console.log(`  Simulation:       passed`);
  console.log(`  Compute units:    ${simulation.unitsConsumed ?? "not reported"}`);

  if (!hasSendApproval()) {
    console.log(
      "\nSimulation only. Review the summary, then rerun with --send to broadcast.",
    );
    return;
  }

  await requireTypedConfirmation("UPDATE NFT");
  const result = await updateBuilder.sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });
  const signature = base58.deserialize(result.signature)[0];
  console.log(`Update confirmed: ${signature}`);

  let updatedAsset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "confirmed",
  });
  for (
    let attempt = 1;
    attempt < 6 &&
    (updatedAsset.name !== NEW_NAME || updatedAsset.uri !== metadataUri);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    updatedAsset = await fetchAsset(umi, ASSET_ADDRESS, {
      commitment: "confirmed",
    });
  }

  if (updatedAsset.name !== NEW_NAME || updatedAsset.uri !== metadataUri) {
    throw new Error("Transaction confirmed, but post-update verification failed.");
  }

  console.log(`Verified asset: ${updatedAsset.publicKey}`);
}

main().catch((error: unknown) => {
  console.error("NFT update failed:", error);
  process.exitCode = 1;
});
