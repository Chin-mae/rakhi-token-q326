import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  compileTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  BASE_UNITS_PER_TOKEN,
  CLUSTER,
  RPC_SUBSCRIPTIONS_URL,
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
} from "./config";
import {
  formatWholeTokens,
  getRequiredAddressArgument,
  getRequiredWholeTokenAmount,
  hasSendApproval,
  loadKitSigner,
  requireTypedConfirmation,
} from "./utils";

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_SUBSCRIPTIONS_URL);

async function main() {
  const mint = getRequiredAddressArgument("mint", 0);
  const recipient = getRequiredAddressArgument("recipient", 1);
  const wholeTokenAmount = getRequiredWholeTokenAmount(2);

  if (!hasSendApproval()) {
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");
    console.log(`Mint: ${mint}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Amount: ${formatWholeTokens(wholeTokenAmount)} ${TOKEN_SYMBOL}`);
    console.log("Run again with --send only after reviewing the transaction summary.");
    return;
  }

  const signer = await loadKitSigner();
  const [sourceAta] = await findAssociatedTokenPda({
    mint,
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [destinationAta] = await findAssociatedTokenPda({
    mint,
    owner: recipient,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const createDestinationAtaInstruction =
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: signer,
      mint,
      owner: recipient,
      ata: destinationAta,
    });
  const transferInstruction = getTransferCheckedInstruction({
    amount: wholeTokenAmount * BASE_UNITS_PER_TOKEN,
    mint,
    decimals: TOKEN_DECIMALS,
    authority: signer,
    source: sourceAta,
    destination: destinationAta,
  });

  console.log("Transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer and source owner: ${signer.address}`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Destination ATA: ${destinationAta}`);
  console.log(`Amount: ${formatWholeTokens(wholeTokenAmount)} ${TOKEN_SYMBOL}`);

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = createTransactionMessage({ version: 0 });
  const messageWithPayer = setTransactionMessageFeePayerSigner(signer, message);
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer,
  );
  const transactionMessage = appendTransactionMessageInstructions(
    [createDestinationAtaInstruction, transferInstruction],
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

  await requireTypedConfirmation("SEND RAKHI TRANSFER");
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  const signature = getSignatureFromTransaction(signedTransaction);
  console.log(`Transfer transaction signature: ${signature}`);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
