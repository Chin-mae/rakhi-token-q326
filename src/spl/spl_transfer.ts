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
  fetchMaybeToken,
  fetchToken,
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
  const transferBaseUnits = wholeTokenAmount * BASE_UNITS_PER_TOKEN;
  const sourceBefore = await fetchToken(rpc, sourceAta, {
    commitment: "confirmed",
  });
  const destinationBefore = await fetchMaybeToken(rpc, destinationAta, {
    commitment: "confirmed",
  });
  const destinationBalanceBefore = destinationBefore.exists
    ? destinationBefore.data.amount
    : 0n;

  if (
    sourceBefore.data.mint !== mint ||
    sourceBefore.data.owner !== signer.address
  ) {
    throw new Error("The source ATA does not match the expected mint and owner.");
  }
  if (
    destinationBefore.exists &&
    (destinationBefore.data.mint !== mint ||
      destinationBefore.data.owner !== recipient)
  ) {
    throw new Error("The destination ATA does not match the expected mint and owner.");
  }
  if (sourceBefore.data.amount < transferBaseUnits) {
    throw new Error("The source ATA does not have enough RAKHI for this transfer.");
  }

  const transferInstruction = getTransferCheckedInstruction({
    amount: transferBaseUnits,
    mint,
    decimals: TOKEN_DECIMALS,
    authority: signer,
    source: sourceAta,
    destination: destinationAta,
  });

  console.log("Transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer and source owner: ${signer.address}`);
  console.log(`Source ATA: ${sourceAta}`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Destination ATA: ${destinationAta}`);
  console.log(`Amount: ${formatWholeTokens(wholeTokenAmount)} ${TOKEN_SYMBOL}`);
  console.log(`Base units: ${transferBaseUnits}`);
  console.log(`Source balance before: ${sourceBefore.data.amount}`);
  console.log(`Destination balance before: ${destinationBalanceBefore}`);

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

  if (!hasSendApproval()) {
    console.log("SIMULATION ONLY — no transaction was signed or sent.");
    console.log("Review the summary, then rerun with --send to broadcast.");
    return;
  }

  await requireTypedConfirmation("SEND RAKHI TRANSFER");
  const { value: freshBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessageWithFreshLifetime =
    setTransactionMessageLifetimeUsingBlockhash(
      freshBlockhash,
      transactionMessage,
    );
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessageWithFreshLifetime);
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

  let sourceAfter = await fetchToken(rpc, sourceAta, {
    commitment: "confirmed",
  });
  let destinationAfter = await fetchToken(rpc, destinationAta, {
    commitment: "confirmed",
  });
  const expectedSourceBalance = sourceBefore.data.amount - transferBaseUnits;
  const expectedDestinationBalance =
    destinationBalanceBefore + transferBaseUnits;

  for (
    let attempt = 1;
    attempt < 6 &&
    (sourceAfter.data.amount !== expectedSourceBalance ||
      destinationAfter.data.amount !== expectedDestinationBalance);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    sourceAfter = await fetchToken(rpc, sourceAta, {
      commitment: "confirmed",
    });
    destinationAfter = await fetchToken(rpc, destinationAta, {
      commitment: "confirmed",
    });
  }

  if (
    sourceAfter.data.amount !== expectedSourceBalance ||
    destinationAfter.data.amount !== expectedDestinationBalance
  ) {
    throw new Error("Transaction confirmed, but balance verification failed.");
  }

  console.log(`Verified source balance: ${sourceAfter.data.amount}`);
  console.log(`Verified destination balance: ${destinationAfter.data.amount}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
