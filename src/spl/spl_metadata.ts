import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createMetadataAccountV3,
  type CreateMetadataAccountV3InstructionAccounts,
  type CreateMetadataAccountV3InstructionArgs,
  type DataV2Args,
} from "@metaplex-foundation/mpl-token-metadata";
import bs58 from "bs58";
import {
  CLUSTER,
  RPC_URL,
  TOKEN_METADATA_URI,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from "./config";
import {
  getRequiredAddressArgument,
  hasSendApproval,
  loadKeypairBytes,
  requireTypedConfirmation,
} from "./utils";

async function main() {
  const mintAddress = getRequiredAddressArgument("mint", 0);

  if (!hasSendApproval()) {
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");
    console.log(`Step: create Metaplex metadata for ${mintAddress}`);
    console.log(`Cluster: ${CLUSTER}`);
    console.log(`Name: ${TOKEN_NAME}`);
    console.log(`Symbol: ${TOKEN_SYMBOL}`);
    console.log(`Metadata URI: ${TOKEN_METADATA_URI}`);
    console.log("Metadata update authority: your signer (metadata remains mutable)");
    console.log("Run again with --send only after reviewing the transaction summary.");
    return;
  }

  const umi = createUmi(RPC_URL);
  const keypair = umi.eddsa.createKeypairFromSecretKey(await loadKeypairBytes());
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  const mint = publicKey(mintAddress);
  const accounts: CreateMetadataAccountV3InstructionAccounts = {
    mint,
    mintAuthority: signer,
  };
  const data: DataV2Args = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: TOKEN_METADATA_URI,
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
  };
  const args: CreateMetadataAccountV3InstructionArgs = {
    data,
    isMutable: true,
    collectionDetails: null,
  };

  console.log("Transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer, mint authority, update authority: ${signer.publicKey}`);
  console.log(`Mint: ${mint}`);
  console.log(`Name / symbol: ${TOKEN_NAME} / ${TOKEN_SYMBOL}`);
  console.log(`Metadata URI: ${TOKEN_METADATA_URI}`);
  console.log("Seller fee: 0% | Metadata mutable: yes");

  const latestBlockhash = await umi.rpc.getLatestBlockhash({
    commitment: "confirmed",
  });
  const transactionBuilder = createMetadataAccountV3(umi, {
    ...accounts,
    ...args,
  }).setBlockhash(latestBlockhash);
  const unsignedTransaction = transactionBuilder.build(umi);
  const simulation = await umi.rpc.simulateTransaction(unsignedTransaction, {
    commitment: "confirmed",
    verifySignatures: false,
    replaceRecentBlockhash: true,
  });

  if (simulation.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.err)}`);
  }
  console.log(
    `Simulation succeeded. Compute units: ${simulation.unitsConsumed ?? "not reported"}`,
  );

  await requireTypedConfirmation("CREATE RAKHI METADATA");
  const freshBlockhash = await umi.rpc.getLatestBlockhash({
    commitment: "confirmed",
  });
  const transactionBuilderWithFreshBlockhash =
    transactionBuilder.setBlockhash(freshBlockhash);
  const signedTransaction =
    await transactionBuilderWithFreshBlockhash.buildAndSign(umi);

  const signature = await umi.rpc.sendTransaction(signedTransaction, {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const confirmation = await umi.rpc.confirmTransaction(signature, {
    commitment: "confirmed",
    strategy: { type: "blockhash", ...freshBlockhash },
  });

  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  const encodedSignature = bs58.encode(Buffer.from(signature));
  console.log(`Metadata transaction signature: ${encodedSignature}`);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${encodedSignature}?cluster=${CLUSTER}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
