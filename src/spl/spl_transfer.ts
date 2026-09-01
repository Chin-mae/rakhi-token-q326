/**
 * OPTIONAL SPL OPERATION: TRANSFER WHOLE RAKHI TOKENS TO ANOTHER WALLET
 *
 * Tokens are not stored directly in wallet addresses. They live in token
 * accounts. This script derives the sender's and recipient's Associated Token
 * Accounts (ATAs), creates the recipient ATA if needed, and moves base units
 * between the two accounts. The mint account and total supply do not change.
 *
 * Security: a wrong recipient address transfers value to the wrong owner and a
 * confirmed transfer generally cannot be reversed. The script validates input
 * and account relationships, checks the balance, simulates by default, requires
 * `--send` plus a typed phrase, refreshes the blockhash, and verifies balances.
 */

// General Solana transaction tools. Named imports let this file use only the
// exported functions listed between `{` and `}`.
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

// SPL Token-specific readers, address derivation, and instruction builders.
import {
  // Reads a token account if it exists and returns an `exists` result instead of
  // throwing when the recipient ATA has not been created yet.
  fetchMaybeToken,
  // Requires and decodes an existing token account (used for the sender).
  fetchToken,
  // Derives the unique ATA address for a mint/owner/program combination.
  findAssociatedTokenPda,
  // Builds safe "create if missing" ATA work.
  getCreateAssociatedTokenIdempotentInstructionAsync,
  // Builds a transfer instruction that verifies the mint's decimal count.
  getTransferCheckedInstruction,
  // Address of the existing original SPL Token Program.
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// Configuration keeps network, decimal conversion, and labels consistent.
import {
  // Number of raw units represented by one whole displayed RAKHI.
  BASE_UNITS_PER_TOKEN,
  CLUSTER,
  RPC_SUBSCRIPTIONS_URL,
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
} from "./config";

// Reusable helpers parse arguments, protect sending, load the signer, and
// format amounts without duplicating security rules.
import {
  formatWholeTokens,
  getRequiredAddressArgument,
  getRequiredWholeTokenAmount,
  hasSendApproval,
  loadKitSigner,
  requireTypedConfirmation,
} from "./utils";

// HTTPS handles reads/submission; WebSocket subscriptions help confirmation.
const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_SUBSCRIPTIONS_URL);

// Orchestrate preparation, simulation, optional broadcast, and verification.
async function main() {
  // Positional arguments are ordered as mint, recipient wallet, whole amount.
  // The helpers reject missing/malformed addresses and non-positive amounts.
  const mint = getRequiredAddressArgument("mint", 0);
  const recipient = getRequiredAddressArgument("recipient", 1);
  const wholeTokenAmount = getRequiredWholeTokenAmount(2);

  // The configured wallet pays fees, owns the source, and signs the transfer.
  const signer = await loadKitSigner();

  // Derive the sender's ATA. `[sourceAta]` destructures the first returned item.
  const [sourceAta] = await findAssociatedTokenPda({
    mint,
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Derive the recipient's ATA for the same mint. This is not the recipient's
  // wallet address; it is the separate account that holds this token balance.
  const [destinationAta] = await findAssociatedTokenPda({
    mint,
    owner: recipient,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Always include idempotent creation so a first-time recipient works while an
  // already-created correct ATA remains safe.
  const createDestinationAtaInstruction =
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      // The sender pays any rent needed to create the recipient's ATA.
      payer: signer,
      mint,
      owner: recipient,
      ata: destinationAta,
    });

  // Convert a human whole-token integer to raw on-chain units with exact bigint
  // multiplication. Removing this conversion would send one-millionth as much.
  const transferBaseUnits = wholeTokenAmount * BASE_UNITS_PER_TOKEN;

  // Fetch the required source account at confirmed commitment. If it is missing,
  // malformed, or not a token account, `fetchToken` fails before construction.
  const sourceBefore = await fetchToken(rpc, sourceAta, {
    commitment: "confirmed",
  });

  // The destination is allowed not to exist because our transaction can create
  // it. `fetchMaybeToken` represents both outcomes without a catch block.
  const destinationBefore = await fetchMaybeToken(rpc, destinationAta, {
    commitment: "confirmed",
  });

  // Ternary syntax `condition ? whenTrue : whenFalse` records an existing
  // balance, otherwise bigint zero for a not-yet-created destination.
  const destinationBalanceBefore = destinationBefore.exists
    ? destinationBefore.data.amount
    : 0n;

  // Never trust derived/fetched account data without checking its relationships.
  // `||` means either a wrong mint or wrong owner is enough to stop.
  if (
    sourceBefore.data.mint !== mint ||
    sourceBefore.data.owner !== signer.address
  ) {
    throw new Error("The source ATA does not match the expected mint and owner.");
  }

  // If a destination account already exists, prove it belongs to the expected
  // recipient and mint. The leading `&&` skips these fields when it is absent.
  if (
    destinationBefore.exists &&
    (destinationBefore.data.mint !== mint ||
      destinationBefore.data.owner !== recipient)
  ) {
    throw new Error("The destination ATA does not match the expected mint and owner.");
  }

  // Compare exact raw balances. Without this check, simulation would catch many
  // insufficient-funds cases, but the human summary would be less reliable.
  if (sourceBefore.data.amount < transferBaseUnits) {
    throw new Error("The source ATA does not have enough RAKHI for this transfer.");
  }

  // Build (but do not yet run) the Token Program transfer instruction.
  const transferInstruction = getTransferCheckedInstruction({
    // The program always moves raw base units.
    amount: transferBaseUnits,
    mint,
    // Checked transfer rejects a mint whose on-chain decimals differ from this.
    decimals: TOKEN_DECIMALS,
    // The signer must have authority over the source token account.
    authority: signer,
    source: sourceAta,
    destination: destinationAta,
  });

  // Review exact roles, accounts, amounts, and pre-state before any signing.
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

  // Construct the same transaction lifecycle used by init/mint: lifetime,
  // payer, ordered instructions, local compilation, and RPC simulation.
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = createTransactionMessage({ version: 0 });
  const messageWithPayer = setTransactionMessageFeePayerSigner(signer, message);
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer,
  );
  const transactionMessage = appendTransactionMessageInstructions(
    // Atomic ordering: create destination ATA if needed, then transfer into it.
    [createDestinationAtaInstruction, transferInstruction],
    messageWithLifetime,
  );
  const unsignedTransaction = compileTransaction(transactionMessage);

  // Simulation executes against current chain state without committing writes.
  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(unsignedTransaction), {
      commitment: "confirmed",
      encoding: "base64",
      // The preview is unsigned, so cryptographic checking is intentionally off.
      sigVerify: false,
    })
    .send();

  // Never present a failing simulation as safe to send.
  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  console.log(
    `Simulation succeeded. Compute units: ${simulation.value.unitsConsumed ?? "not reported"}`,
  );

  // Unlike init/mint, this script always builds and simulates first. Without
  // `--send`, it exits here and becomes a read/simulation-only command.
  if (!hasSendApproval()) {
    console.log("SIMULATION ONLY — no transaction was signed or sent.");
    console.log("Review the summary, then rerun with --send to broadcast.");
    return;
  }

  // Require explicit human acknowledgement after the exact recipient/amount
  // have been printed and simulation has passed.
  await requireTypedConfirmation("SEND RAKHI TRANSFER");

  // Replace the possibly aging simulated blockhash just before signing.
  const { value: freshBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessageWithFreshLifetime =
    setTransactionMessageLifetimeUsingBlockhash(
      freshBlockhash,
      transactionMessage,
    );

  // Cryptographically authorise fee payment and debit from the source ATA.
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessageWithFreshLifetime);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  // Create the broadcaster/confirmation helper from both network transports.
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // SECURITY: this is the irreversible value-moving broadcast.
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  // Print durable transaction evidence only after confirmation returns.
  const signature = getSignatureFromTransaction(signedTransaction);
  console.log(`Transfer transaction signature: ${signature}`);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`,
  );

  // First read of post-state. `let` is used instead of `const` because polling
  // may replace these values with fresher RPC responses.
  let sourceAfter = await fetchToken(rpc, sourceAta, {
    commitment: "confirmed",
  });
  let destinationAfter = await fetchToken(rpc, destinationAta, {
    commitment: "confirmed",
  });

  // Calculate expected conservation: sender loses exactly what recipient gains.
  const expectedSourceBalance = sourceBefore.data.amount - transferBaseUnits;
  const expectedDestinationBalance =
    destinationBalanceBefore + transferBaseUnits;

  // RPC nodes can briefly serve older cached/account state after confirmation.
  // Retry at most five times while either (`||`) balance is not as expected.
  for (
    // Start retry counter at one.
    let attempt = 1;
    // Continue only while retries remain AND some value is stale.
    attempt < 6 &&
    (sourceAfter.data.amount !== expectedSourceBalance ||
      destinationAfter.data.amount !== expectedDestinationBalance);
    // Increment after each loop body.
    attempt += 1
  ) {
    // Promise + setTimeout creates an asynchronous 1.5-second pause without
    // blocking Node's event loop. It gives the RPC node time to catch up.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // Replace both mutable snapshots with fresh confirmed reads.
    sourceAfter = await fetchToken(rpc, sourceAta, {
      commitment: "confirmed",
    });
    destinationAfter = await fetchToken(rpc, destinationAta, {
      commitment: "confirmed",
    });
  }

  // After bounded retries, any mismatch is reported honestly instead of
  // claiming the intended transfer was verified.
  if (
    sourceAfter.data.amount !== expectedSourceBalance ||
    destinationAfter.data.amount !== expectedDestinationBalance
  ) {
    throw new Error("Transaction confirmed, but balance verification failed.");
  }

  // These logs are verified post-state, not estimates from the transaction.
  console.log(`Verified source balance: ${sourceAfter.data.amount}`);
  console.log(`Verified destination balance: ${destinationAfter.data.amount}`);
}

// Convert any rejected Promise into a readable error and failed process status.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
