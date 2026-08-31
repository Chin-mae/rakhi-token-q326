import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";

const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const ASSET_ADDRESS = publicKey(
  "BAoQMWun1TB1s2K6doBdUmeKiTsQfhR9AabfVxUFshx4",
);
const UPDATE_AUTHORITY = publicKey(
  "GzxbTnfFevizoZChrcG5RtKBZw3THEEXBgcbiGNUHapJ",
);
const CURRENT_OWNER = publicKey(
  "DFA7MYRrMRody7RdSN8RtgyiYL96nLMuh41Eyp3KuXu5",
);
const CURRENT_NAME = "Solana spawnpoint";
const CURRENT_METADATA_URI =
  "https://gateway.irys.xyz/ApgZVZ1AQj7HndT2TENsdVjHadeDtiPcYFaLn2tP3JHo";
const UPDATE_SIGNATURE =
  "xMynVy2nBVycvtp5CuSw4452pi8W7jviJPgMvYP5vccEHg2sdKwcZcuiwgWMjVpAYBYMPkbB63BfWmxPfabTpzu";
const TRANSFER_SIGNATURE =
  "KWraJtdrzV5UbvHYaUzFT1rBm3sWRDHkLkZ7UNW6hZDukBAtLmwHpvQHKvWQu4ZND9iDjxgKneocwUq4WU7tJWM";

type VerificationStage = "update" | "transfer" | "all";

function getStage(): VerificationStage {
  const stage = process.argv[2] ?? "all";
  if (stage !== "update" && stage !== "transfer" && stage !== "all") {
    throw new Error("Stage must be update, transfer, or all.");
  }
  return stage;
}

async function main(): Promise<void> {
  const stage = getStage();
  const umi = createUmi(DEVNET_RPC_URL).use(mplCore());
  const asset = await fetchAsset(umi, ASSET_ADDRESS, {
    commitment: "finalized",
  });

  if (
    asset.name !== CURRENT_NAME ||
    asset.uri !== CURRENT_METADATA_URI ||
    asset.owner !== CURRENT_OWNER ||
    asset.updateAuthority.type !== "Address" ||
    asset.updateAuthority.address !== UPDATE_AUTHORITY
  ) {
    throw new Error("The finalized Core asset state does not match expectations.");
  }

  const requestedSignatures = [
    ...(stage === "update" || stage === "all" ? [UPDATE_SIGNATURE] : []),
    ...(stage === "transfer" || stage === "all" ? [TRANSFER_SIGNATURE] : []),
  ];
  const statuses = await umi.rpc.getSignatureStatuses(
    requestedSignatures.map((signature) => base58.serialize(signature)),
    { searchTransactionHistory: true },
  );

  for (const [index, status] of statuses.entries()) {
    if (!status || status.error || status.commitment !== "finalized") {
      throw new Error(
        `Transaction verification failed for ${requestedSignatures[index]}.`,
      );
    }
  }

  console.log("METAPLEX CORE NFT — LIVE DEVNET VERIFICATION");
  console.log("================================================");
  console.log(`Asset:            ${asset.publicKey}`);
  console.log(`Current name:     ${asset.name}`);
  console.log(`Metadata URI:     ${asset.uri}`);
  console.log(`Current owner:    ${asset.owner}`);
  console.log(`Update authority: ${asset.updateAuthority.address}`);

  let statusIndex = 0;
  if (stage === "update" || stage === "all") {
    const status = statuses[statusIndex];
    statusIndex += 1;
    console.log("\nNFT UPDATE");
    console.log(`Signature:         ${UPDATE_SIGNATURE}`);
    console.log(`Status:            ${status?.commitment}`);
    console.log(`Transaction error: ${status?.error ?? "none"}`);
    console.log(`Verified name:     ${asset.name}`);
    console.log(`Verified URI:      ${asset.uri}`);
    console.log(`Update authority:  ${asset.updateAuthority.address}`);
    console.log("Result:            UPDATE VERIFIED");
  }

  if (stage === "transfer" || stage === "all") {
    const status = statuses[statusIndex];
    console.log("\nNFT OWNERSHIP TRANSFER");
    console.log(`Signature:         ${TRANSFER_SIGNATURE}`);
    console.log(`Status:            ${status?.commitment}`);
    console.log(`Transaction error: ${status?.error ?? "none"}`);
    console.log(`Verified owner:    ${asset.owner}`);
    console.log(`Update authority:  ${asset.updateAuthority.address}`);
    console.log("Result:            TRANSFER VERIFIED");
  }
}

main().catch((error: unknown) => {
  console.error(
    "NFT verification failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
