import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  compileTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isNone,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  AuthorityType,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToCheckedInstruction,
  getSetAuthorityInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  CLUSTER,
  RPC_SUBSCRIPTIONS_URL,
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOTAL_SUPPLY,
  TOTAL_SUPPLY_BASE_UNITS,
} from "./config";
import {
  formatWholeTokens,
  getRequiredAddressArgument,
  hasSendApproval,
  loadKitSigner,
  requireTypedConfirmation,
} from "./utils";

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_SUBSCRIPTIONS_URL);

async function main() {
  const mint = getRequiredAddressArgument("mint", 0);

  if (!hasSendApproval()) {
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");
    console.log(`Step: mint ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);
    console.log(`Destination: your ATA for mint ${mint}`);
    console.log("Final instruction: permanently revoke mint authority");
    console.log("Atomic result: mint + revocation both succeed, or neither does");
    console.log("Run again with --send only after reviewing the transaction summary.");
    return;
  }

  const signer = await loadKitSigner();
  const [ata] = await findAssociatedTokenPda({
    mint,
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const createAtaInstruction =
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: signer,
      mint,
      owner: signer.address,
      ata,
    });
  const mintInstruction = getMintToCheckedInstruction({
    amount: TOTAL_SUPPLY_BASE_UNITS,
    decimals: TOKEN_DECIMALS,
    mint,
    mintAuthority: signer,
    token: ata,
  });
  const revokeMintAuthorityInstruction = getSetAuthorityInstruction({
    owned: mint,
    owner: signer,
    authorityType: AuthorityType.MintTokens,
    newAuthority: null,
  });

  console.log("IRREVERSIBLE transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer and current mint authority: ${signer.address}`);
  console.log(`Mint: ${mint}`);
  console.log(`Destination ATA: ${ata}`);
  console.log(`Amount: ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);
  console.log(`Base units: ${TOTAL_SUPPLY_BASE_UNITS}`);
  console.log("Final mint authority: none (permanent)");

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = createTransactionMessage({ version: 0 });
  const messageWithPayer = setTransactionMessageFeePayerSigner(signer, message);
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer,
  );
  const transactionMessage = appendTransactionMessageInstructions(
    [
      createAtaInstruction,
      mintInstruction,
      revokeMintAuthorityInstruction,
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

  await requireTypedConfirmation("MINT 4171512569 RAKHI");
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  const mintAccount = await fetchMint(rpc, mint, { commitment: "confirmed" });
  const tokenAccount = await fetchToken(rpc, ata, { commitment: "confirmed" });
  if (mintAccount.programAddress !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("Post-transaction verification found the wrong mint owner program.");
  }
  if (mintAccount.data.supply !== TOTAL_SUPPLY_BASE_UNITS) {
    throw new Error("Post-transaction verification found an unexpected supply.");
  }
  if (!isNone(mintAccount.data.mintAuthority)) {
    throw new Error("Post-transaction verification found mint authority still enabled.");
  }
  if (tokenAccount.data.amount !== TOTAL_SUPPLY_BASE_UNITS) {
    throw new Error("Post-transaction verification found an unexpected ATA balance.");
  }
  if (
    tokenAccount.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    tokenAccount.data.mint !== mint ||
    tokenAccount.data.owner !== signer.address
  ) {
    throw new Error("Post-transaction verification found an unexpected ATA owner or mint.");
  }

  const signature = getSignatureFromTransaction(signedTransaction);
  console.log(`Minted ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_NAME}.`);
  console.log("Verified mint authority: none");
  console.log(`Verified ATA balance: ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);
  console.log(`Transaction signature: ${signature}`);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
