import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  compileTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isNone,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  fetchMint,
  getInitializeMintInstruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  CLUSTER,
  RPC_SUBSCRIPTIONS_URL,
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from "./config";
import {
  hasSendApproval,
  loadKitSigner,
  requireTypedConfirmation,
} from "./utils";

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_SUBSCRIPTIONS_URL);

async function main() {
  if (!hasSendApproval()) {
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");
    console.log(`Step: create the ${TOKEN_NAME} (${TOKEN_SYMBOL}) mint`);
    console.log(`Cluster: ${CLUSTER}`);
    console.log(`Decimals: ${TOKEN_DECIMALS}`);
    console.log("Freeze authority: none");
    console.log("Run again with --send only after reviewing the transaction summary.");
    return;
  }

  const signer = await loadKitSigner();
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  console.log("Transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer and mint authority: ${signer.address}`);
  console.log(`New mint: ${mint.address}`);
  console.log(`Decimals: ${TOKEN_DECIMALS}`);
  console.log("Freeze authority: none");
  console.log(`Mint-account rent: ${rent} lamports`);

  const message = createTransactionMessage({ version: 0 });
  const messageWithPayer = setTransactionMessageFeePayerSigner(signer, message);
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer,
  );
  const transactionMessage = appendTransactionMessageInstructions(
    [
      getCreateAccountInstruction({
        payer: signer,
        newAccount: mint,
        lamports: rent,
        space,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMintInstruction({
        mint: mint.address,
        decimals: TOKEN_DECIMALS,
        mintAuthority: signer.address,
        freezeAuthority: null,
      }),
    ],
    messageWithLifetime,
  );

  const unsignedTransaction = compileTransaction(transactionMessage);
  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(unsignedTransaction), {
      commitment: "confirmed",
      encoding: "base64",
      sigVerify: false,
    })
    .send();

  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  console.log(
    `Simulation succeeded. Compute units: ${simulation.value.unitsConsumed ?? "not reported"}`,
  );

  await requireTypedConfirmation("CREATE RAKHI MINT");
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  const mintAccount = await fetchMint(rpc, mint.address, {
    commitment: "confirmed",
  });
  if (
    mintAccount.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    mintAccount.data.decimals !== TOKEN_DECIMALS ||
    mintAccount.data.supply !== 0n ||
    isNone(mintAccount.data.mintAuthority) ||
    mintAccount.data.mintAuthority.value !== signer.address ||
    !isNone(mintAccount.data.freezeAuthority)
  ) {
    throw new Error("Post-transaction mint verification failed.");
  }

  const signature = getSignatureFromTransaction(signedTransaction);
  console.log(`Mint address: ${mint.address}`);
  console.log(`Transaction signature: ${signature}`);
  console.log(
    `Explorer: https://explorer.solana.com/address/${mint.address}?cluster=${CLUSTER}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
