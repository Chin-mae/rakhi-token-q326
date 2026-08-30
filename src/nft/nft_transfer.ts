import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { fetchAsset, mplCore, transfer } from "@metaplex-foundation/mpl-core";
import {
  hasSendApproval,
  loadKeypairBytes,
  requireTypedConfirmation,
} from "../spl/utils";

const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const ASSET_ADDRESS = publicKey(
  "BAoQMWun1TB1s2K6doBdUmeKiTsQfhR9AabfVxUFshx4",
);
const NEW_OWNER = publicKey(
  "DFA7MYRrMRody7RdSN8RtgyiYL96nLMuh41Eyp3KuXu5",
);

async function main(): Promise<void> {
  const umi = createUmi(DEVNET_RPC_URL).use(mplCore());
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    await loadKeypairBytes(),
  );
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  const asset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "confirmed",
  });

  if (asset.owner !== signer.publicKey) {
    throw new Error(
      `CLI wallet ${signer.publicKey} is not the current owner ${asset.owner}.`,
    );
  }
  if (
    asset.updateAuthority.type !== "Address" ||
    asset.updateAuthority.address !== signer.publicKey
  ) {
    throw new Error(
      "The CLI wallet is not the address-based update authority; refusing to transfer under the stated authority plan.",
    );
  }
  if (NEW_OWNER === asset.owner) {
    throw new Error("The recipient already owns this asset.");
  }

  console.log("NFT ownership transfer summary:");
  console.log(`  Cluster:           devnet`);
  console.log(`  Asset:             ${asset.publicKey}`);
  console.log(`  Name:              ${asset.name}`);
  console.log(`  Current owner:     ${asset.owner}`);
  console.log(`  New owner:         ${NEW_OWNER}`);
  console.log(`  Payer/authority:   ${signer.publicKey}`);
  console.log(`  Update authority:  ${asset.updateAuthority.address} (unchanged)`);

  const transferBuilder = transfer(umi, {
    asset,
    authority: signer,
    payer: signer,
    newOwner: NEW_OWNER,
  });

  const unsignedTransaction = await transferBuilder.buildWithLatestBlockhash(umi);
  const simulation = await umi.rpc.simulateTransaction(unsignedTransaction, {
    verifySignatures: false,
  });
  if (simulation.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.err)}`);
  }

  console.log(`  Simulation:        passed`);
  console.log(`  Compute units:     ${simulation.unitsConsumed ?? "not reported"}`);

  if (!hasSendApproval()) {
    console.log(
      "\nSimulation only. Review the summary, then rerun with --send to broadcast.",
    );
    return;
  }

  await requireTypedConfirmation("TRANSFER NFT");
  const result = await transferBuilder.sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });
  const signature = base58.deserialize(result.signature)[0];
  console.log(`Transfer confirmed: ${signature}`);

  let transferredAsset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "confirmed",
  });
  for (
    let attempt = 1;
    attempt < 6 && transferredAsset.owner !== NEW_OWNER;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    transferredAsset = await fetchAsset(umi, ASSET_ADDRESS, {
      commitment: "confirmed",
    });
  }

  if (transferredAsset.owner !== NEW_OWNER) {
    throw new Error("Transaction confirmed, but owner verification failed.");
  }
  if (
    transferredAsset.updateAuthority.type !== "Address" ||
    transferredAsset.updateAuthority.address !== signer.publicKey
  ) {
    throw new Error("Ownership changed, but update-authority verification failed.");
  }

  console.log(`Verified new owner: ${transferredAsset.owner}`);
  console.log(
    `Verified update authority unchanged: ${transferredAsset.updateAuthority.address}`,
  );
}

main().catch((error: unknown) => {
  console.error("NFT transfer failed:", error);
  process.exitCode = 1;
});
