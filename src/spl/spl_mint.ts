/**
 * STEP 3 OF THE SPL FLOW: CREATE THE SUPPLY, STORE IT, AND MAKE IT FIXED
 *
 * `spl_init.ts` created a mint definition with zero supply. This file:
 * 1. derives the wallet's Associated Token Account (ATA),
 * 2. creates that ATA if it does not exist,
 * 3. mints the entire configured RAKHI supply into it, and
 * 4. permanently sets the mint authority to `None`.
 *
 * The three instructions share one atomic transaction: Solana applies all of
 * them or none of them. That prevents a half-finished state where supply exists
 * but the intended authority revocation failed.
 *
 * Security: revoking mint authority is irreversible. After success, no wallet
 * can create more RAKHI. This script therefore defaults to a plan, simulates,
 * shows an irreversible summary, requires an exact phrase, and signs only with
 * a freshly fetched blockhash.
 */

// Solana Kit tools used to assemble, simulate, sign, send, and inspect one
// versioned transaction. See `spl_init.ts` for the same lifecycle in step form.
import {
  // Combines the ATA, mint, and authority instructions in a chosen order.
  appendTransactionMessageInstructions,
  // Proves the signed transaction has a blockhash lifetime before submission.
  assertIsTransactionWithBlockhashLifetime,
  // Converts a message description into wire-ready transaction data.
  compileTransaction,
  // HTTPS RPC client constructor.
  createSolanaRpc,
  // WebSocket confirmation client constructor.
  createSolanaRpcSubscriptions,
  // Starts an empty version-0 message.
  createTransactionMessage,
  // Encodes an unsigned transaction for the JSON-RPC simulator.
  getBase64EncodedWireTransaction,
  // Extracts the final transaction signature/ID.
  getSignatureFromTransaction,
  // Checks whether an optional authority value is absent.
  isNone,
  // Builds the submit-and-wait helper.
  sendAndConfirmTransactionFactory,
  // Adds the wallet as fee payer.
  setTransactionMessageFeePayerSigner,
  // Adds a recent blockhash and expiration window.
  setTransactionMessageLifetimeUsingBlockhash,
  // Applies every signature required by the instructions/message.
  signTransactionMessageWithSigners,
} from "@solana/kit";

// SPL Token helpers understand mint accounts, token accounts, authorities, and
// Associated Token Account address derivation.
import {
  // Enum listing which authority role a SetAuthority instruction changes.
  AuthorityType,
  // Reads/decodes a mint account for post-transaction verification.
  fetchMint,
  // Reads/decodes a token account (the ATA holding balances).
  fetchToken,
  // Deterministically derives an ATA address from owner + mint + token program.
  findAssociatedTokenPda,
  // Creates the ATA only when needed; "idempotent" means an existing correct
  // ATA does not make the instruction fail.
  getCreateAssociatedTokenIdempotentInstructionAsync,
  // Builds a decimals-checked MintTo instruction.
  getMintToCheckedInstruction,
  // Builds the instruction that changes/removes an authority.
  getSetAuthorityInstruction,
  // Identifies the existing original SPL Token Program.
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// Central configuration supplies network details and the exact supply math.
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

// Shared helpers handle readable output, arguments, wallet loading, and gates.
import {
  formatWholeTokens,
  getRequiredAddressArgument,
  hasSendApproval,
  loadKitSigner,
  requireTypedConfirmation,
} from "./utils";

// Network clients are inert until a method ending in `.send()` or a send helper
// is called. `const` prevents them from being replaced later in the file.
const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_SUBSCRIPTIONS_URL);

// Main asynchronous workflow for this one-off fixed-supply operation.
async function main() {
  // Argument position 0 must be the mint produced by `spl_init.ts`.
  const mint = getRequiredAddressArgument("mint", 0);

  // With no `--send`, show the irreversible plan and stop before wallet access.
  if (!hasSendApproval()) {
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");
    console.log(`Step: mint ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);

    // The ATA is derived after wallet loading; at plan stage the mint is enough
    // to explain where tokens will ultimately be held.
    console.log(`Destination: your ATA for mint ${mint}`);

    // This line calls out the permanent part of the transaction.
    console.log("Final instruction: permanently revoke mint authority");
    console.log("Atomic result: mint + revocation both succeed, or neither does");
    console.log("Run again with --send only after reviewing the transaction summary.");
    return;
  }

  // This signer pays fees, owns the destination ATA, and currently controls the
  // mint authority. Loading it does not sign anything yet.
  const signer = await loadKitSigner();

  // A PDA is an address derived from fixed seeds. `[ata]` array destructuring
  // takes the derived address while ignoring any extra returned data/bump.
  const [ata] = await findAssociatedTokenPda({
    // One side of the unique ATA relationship.
    mint,
    // The other side: this wallet will own the balance account.
    owner: signer.address,
    // Include the correct token-program variant in derivation.
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Build an instruction that safely creates the ATA if absent. If it already
  // exists with the expected derivation, the idempotent instruction is harmless.
  const createAtaInstruction =
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      // Pays account-creation rent/fees when creation is necessary.
      payer: signer,
      mint,
      owner: signer.address,
      ata,
    });

  // Build the instruction that increases both mint supply and ATA balance.
  const mintInstruction = getMintToCheckedInstruction({
    // Raw integer base units, already multiplied by 10^decimals.
    amount: TOTAL_SUPPLY_BASE_UNITS,
    // Checked instruction verifies our expectation against the mint on-chain.
    decimals: TOKEN_DECIMALS,
    mint,
    // This signer must match the mint's current mint authority.
    mintAuthority: signer,
    // `token` is the destination token-account role expected by this API.
    token: ata,
  });

  // Build the irreversible authority-removal instruction.
  const revokeMintAuthorityInstruction = getSetAuthorityInstruction({
    // `owned` is the account whose authority is being changed: the mint.
    owned: mint,
    // Current authority must sign this change.
    owner: signer,
    // Change only permission to mint more tokens, not another authority type.
    authorityType: AuthorityType.MintTokens,
    // `null` maps to no successor authority. There is no private key that can
    // undo this after confirmation.
    newAuthority: null,
  });

  // Human-readable review of every important address, role, and exact amount.
  console.log("IRREVERSIBLE transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer and current mint authority: ${signer.address}`);
  console.log(`Mint: ${mint}`);
  console.log(`Destination ATA: ${ata}`);
  console.log(`Amount: ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);
  console.log(`Base units: ${TOTAL_SUPPLY_BASE_UNITS}`);
  console.log("Final mint authority: none (permanent)");

  // Fetch a short-lived blockhash and begin a version-0 transaction message.
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = createTransactionMessage({ version: 0 });

  // Each helper returns a progressively enriched message: payer, then lifetime,
  // then the ordered instructions.
  const messageWithPayer = setTransactionMessageFeePayerSigner(signer, message);
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer,
  );
  const transactionMessage = appendTransactionMessageInstructions(
    [
      // Order is significant: establish storage, mint into it, then revoke.
      createAtaInstruction,
      mintInstruction,
      revokeMintAuthorityInstruction,
    ],
    messageWithLifetime,
  );

  // Compile locally without signatures for safe simulation.
  const unsignedTransaction = compileTransaction(transactionMessage);
  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(unsignedTransaction), {
      commitment: "confirmed",
      encoding: "base64",
      // Unsigned preview deliberately bypasses signature verification.
      sigVerify: false,
    })
    .send();

  // Never request irreversible approval when the preview reports an error.
  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  console.log(
    // Nullish coalescing (`??`) provides fallback text only if no count exists.
    `Simulation succeeded. Compute units: ${simulation.value.unitsConsumed ?? "not reported"}`,
  );

  // Exact phrase forces the user to acknowledge both amount and token symbol.
  await requireTypedConfirmation("MINT 4171512569 RAKHI");

  // Refresh after review/typing so expiry is measured from the signing moment.
  const { value: freshBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessageWithFreshLifetime =
    setTransactionMessageLifetimeUsingBlockhash(
      freshBlockhash,
      transactionMessage,
    );

  // Apply the wallet's fee-payer/mint-authority signature.
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessageWithFreshLifetime);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  // Bind the request and subscription clients into one send/confirmation helper.
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // SECURITY: this line broadcasts the atomic state change and waits for it.
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  // Read both affected accounts back from Solana to verify final reality rather
  // than equating "submitted" or even "confirmed" with the intended outcome.
  const mintAccount = await fetchMint(rpc, mint, { commitment: "confirmed" });
  const tokenAccount = await fetchToken(rpc, ata, { commitment: "confirmed" });

  // Ensure this is an original SPL Token mint, not an unexpected account type
  // or Token-2022 account controlled by a different program.
  if (mintAccount.programAddress !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("Post-transaction verification found the wrong mint owner program.");
  }

  // Exact bigint comparison proves supply equals configuration.
  if (mintAccount.data.supply !== TOTAL_SUPPLY_BASE_UNITS) {
    throw new Error("Post-transaction verification found an unexpected supply.");
  }

  // `!isNone(...)` means an authority still exists, which would violate the
  // promised fixed-supply property.
  if (!isNone(mintAccount.data.mintAuthority)) {
    throw new Error("Post-transaction verification found mint authority still enabled.");
  }

  // Verify the destination actually received every base unit.
  if (tokenAccount.data.amount !== TOTAL_SUPPLY_BASE_UNITS) {
    throw new Error("Post-transaction verification found an unexpected ATA balance.");
  }

  // A balance alone is insufficient: also prove program, mint relation, and
  // owner so a different account cannot accidentally satisfy the amount check.
  if (
    tokenAccount.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    tokenAccount.data.mint !== mint ||
    tokenAccount.data.owner !== signer.address
  ) {
    throw new Error("Post-transaction verification found an unexpected ATA owner or mint.");
  }

  // Extract durable evidence and print the verified result for the learner.
  const signature = getSignatureFromTransaction(signedTransaction);
  console.log(`Minted ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_NAME}.`);
  console.log("Verified mint authority: none");
  console.log(`Verified ATA balance: ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);
  console.log(`Transaction signature: ${signature}`);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`,
  );
}

// Top-level Promise error handling: print safely and return a failure exit code.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
