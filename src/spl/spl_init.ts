/**
 * STEP 1 OF THE SPL FLOW: CREATE AND INITIALISE A MINT ACCOUNT
 *
 * Mental model:
 * 1. The SPL Token Program already exists at `TOKEN_PROGRAM_ADDRESS`.
 * 2. This script generates a new address/keypair for a mint account.
 * 3. One transaction asks the System Program to create that account and asks
 *    the existing Token Program to initialise its token rules.
 * 4. The new mint starts with a supply of zero. `spl_mint.ts`, not this file,
 *    later creates the actual token units.
 *
 * Security: the real path spends devnet SOL for rent/fees and creates permanent
 * on-chain state. It is gated by `--send`, simulation, a typed phrase, and a
 * fresh blockhash. Merely importing or opening this file does nothing.
 */

// These named imports are transaction-building tools from Solana Kit.
import {
  // Adds one or more program instructions to a transaction message.
  appendTransactionMessageInstructions,
  // Runtime check proving the signed transaction has blockhash-based expiry.
  assertIsTransactionWithBlockhashLifetime,
  // Turns the readable message description into Solana's transaction format.
  compileTransaction,
  // Creates the HTTPS client used for requests and reads.
  createSolanaRpc,
  // Creates the WebSocket client used to observe confirmation.
  createSolanaRpcSubscriptions,
  // Starts an empty versioned transaction message.
  createTransactionMessage,
  // Generates the new mint's random keypair and signer.
  generateKeyPairSigner,
  // Serialises a compiled transaction for the simulation RPC method.
  getBase64EncodedWireTransaction,
  // Reads the transaction ID/signature from a signed transaction.
  getSignatureFromTransaction,
  // Tests whether an optional Solana value represents `None`.
  isNone,
  // Creates a helper that submits and waits for confirmation.
  sendAndConfirmTransactionFactory,
  // Declares who pays the network fee and supplies that signer's authority.
  setTransactionMessageFeePayerSigner,
  // Gives the message a recent blockhash and expiry window.
  setTransactionMessageLifetimeUsingBlockhash,
  // Asks every signer referenced by the message to sign it.
  signTransactionMessageWithSigners,
} from "@solana/kit";

// These imports describe the original SPL Token Program and its mint accounts.
import {
  // Downloads and decodes an existing mint account after creation.
  fetchMint,
  // Builds the Token Program instruction that initialises a new mint.
  getInitializeMintInstruction,
  // Returns the exact byte size required for this type of mint account.
  getMintSize,
  // Address of the already-deployed original SPL Token Program. This script
  // uses this program; it does not create the program or its address.
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// The System Program is responsible for allocating a new on-chain account.
import { getCreateAccountInstruction } from "@solana-program/system";

// Project-wide values are imported from one source of truth.
import {
  // Network label printed in summaries and explorer links.
  CLUSTER,
  // WebSocket confirmation endpoint.
  RPC_SUBSCRIPTIONS_URL,
  // HTTPS request endpoint.
  RPC_URL,
  // Number of fractional decimal places stored by the mint.
  TOKEN_DECIMALS,
  // Human-readable display name.
  TOKEN_NAME,
  // Short display symbol.
  TOKEN_SYMBOL,
} from "./config";

// Local helpers implement approval and wallet safety rules.
import {
  // Checks whether the command includes `--send`.
  hasSendApproval,
  // Loads the configured wallet as a Solana Kit signer.
  loadKitSigner,
  // Requires an exact typed phrase before signing.
  requireTypedConfirmation,
} from "./utils";

// Create reusable network clients. `const` prevents accidental reassignment;
// neither line sends a transaction by itself.
const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_SUBSCRIPTIONS_URL);

// `async` lets this function wait for RPC, wallet, simulation, and confirmation
// operations. `main` is the script's organised entry point.
async function main() {
  // The leading `!` means "not". Without explicit send approval, show the
  // intended action and exit before loading a wallet or building a transaction.
  if (!hasSendApproval()) {
    // `console.log` writes learning/review information to the terminal only.
    console.log("PLAN ONLY — no transaction was created, signed, or sent.");

    // Backticks create template literals; `${...}` inserts live values.
    console.log(`Step: create the ${TOKEN_NAME} (${TOKEN_SYMBOL}) mint`);
    console.log(`Cluster: ${CLUSTER}`);
    console.log(`Decimals: ${TOKEN_DECIMALS}`);

    // No freeze authority means nobody will be able to freeze token accounts.
    console.log("Freeze authority: none");
    console.log("Run again with --send only after reviewing the transaction summary.");

    // `return` ends `main` here. Removing it would allow the transaction path to
    // continue even after presenting itself as plan-only.
    return;
  }

  // Load the CLI wallet. It will pay fees and become the mint authority.
  const signer = await loadKitSigner();

  // Create a fresh local keypair for the not-yet-existing mint account. The
  // public address identifies the mint; this signer authorises its creation.
  const mint = await generateKeyPairSigner();

  // Determine the mint account's storage bytes, then use `BigInt` because RPC
  // lamport and size calculations use exact integer values.
  const space = BigInt(getMintSize());

  // Ask how many lamports must be deposited so the account is rent-exempt.
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();

  // A recent blockhash makes a transaction short-lived and prevents old signed
  // transactions from being replayed indefinitely. Destructuring extracts
  // the `value` field and renames it `latestBlockhash`.
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Print every security-relevant role and cost before construction/signing.
  console.log("Transaction summary");
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Fee payer and mint authority: ${signer.address}`);
  console.log(`New mint: ${mint.address}`);
  console.log(`Decimals: ${TOKEN_DECIMALS}`);
  console.log("Freeze authority: none");
  console.log(`Mint-account rent: ${rent} lamports`);

  // Begin a version-0 transaction message. A message describes requested work;
  // it is not signed or sent yet.
  const message = createTransactionMessage({ version: 0 });

  // Return a new message containing the wallet as fee payer. Solana message
  // helpers are immutable: they return updated values rather than changing the
  // original variable.
  const messageWithPayer = setTransactionMessageFeePayerSigner(signer, message);

  // Attach the blockhash/expiry information required by the runtime.
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer,
  );

  // Append two instructions in order. Solana executes transaction instructions
  // atomically: both succeed, or the entire transaction is rolled back.
  const transactionMessage = appendTransactionMessageInstructions(
    [
      // Instruction 1: ask the System Program to allocate the mint account.
      getCreateAccountInstruction({
        // The wallet supplies the rent deposit and network fee.
        payer: signer,
        // The generated mint signer authorises creating this new address.
        newAccount: mint,
        // Exact rent-exempt deposit calculated above.
        lamports: rent,
        // Exact bytes required to store mint data.
        space,
        // Makes the existing SPL Token Program the new account's owner program.
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      // Instruction 2: write the initial mint configuration into that account.
      getInitializeMintInstruction({
        // Instructions generally use public addresses, not private keys.
        mint: mint.address,
        // Establishes the base-unit/display conversion permanently.
        decimals: TOKEN_DECIMALS,
        // This wallet may create token units until authority is later revoked.
        mintAuthority: signer.address,
        // `null` means no freeze authority exists.
        freezeAuthority: null,
      }),
    ],
    messageWithLifetime,
  );

  // Compile without signatures so the exact proposed transaction can be safely
  // simulated. Compilation is local and does not touch the blockchain.
  const unsignedTransaction = compileTransaction(transactionMessage);

  // The dot at each line continues one method chain: encode -> request a
  // simulation -> send that read request to RPC -> wait for the response.
  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(unsignedTransaction), {
      // `confirmed` asks the RPC node to simulate against reasonably settled
      // state rather than the fastest, least-settled view.
      commitment: "confirmed",
      // The wire transaction is represented as Base64 text in JSON RPC.
      encoding: "base64",
      // The unsigned preview deliberately skips cryptographic signature checks.
      sigVerify: false,
    })
    .send();

  // Any simulated program error stops execution before real signing.
  if (simulation.value.err) {
    // JSON.stringify turns structured RPC error data into readable text.
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  // `??` uses the fallback only when unitsConsumed is null or undefined.
  console.log(
    `Simulation succeeded. Compute units: ${simulation.value.unitsConsumed ?? "not reported"}`,
  );

  // Human checkpoint after simulation and before accessing signing power.
  await requireTypedConfirmation("CREATE RAKHI MINT");

  // Fetch again because the simulation/review delay may have made the first
  // blockhash expire. Signing with a fresh value reduces BlockhashNotFound risk.
  const { value: freshBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessageWithFreshLifetime =
    setTransactionMessageLifetimeUsingBlockhash(
      freshBlockhash,
      transactionMessage,
    );

  // The wallet signs as payer/mint authority and the new mint signs to authorise
  // creation. This is the first point where cryptographic signatures are made.
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessageWithFreshLifetime);

  // Narrow the runtime/type representation before the send helper uses it.
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  // Combine HTTPS submission and WebSocket confirmation clients.
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // This is the state-changing broadcast. `await` keeps the script from reading
  // post-state until the network reports confirmed execution.
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  // Read the new mint back from chain rather than trusting submission alone.
  const mintAccount = await fetchMint(rpc, mint.address, {
    commitment: "confirmed",
  });

  // Verify every invariant established by the two instructions. `||` means any
  // mismatch fails the check; strict `!==` prevents type coercion surprises.
  if (
    // The expected Token Program must own the mint account.
    mintAccount.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    // Decimals must match configuration.
    mintAccount.data.decimals !== TOKEN_DECIMALS ||
    // Initialisation alone must not create any token units.
    mintAccount.data.supply !== 0n ||
    // The mint authority must exist at this stage...
    isNone(mintAccount.data.mintAuthority) ||
    // ...and it must be this wallet.
    mintAccount.data.mintAuthority.value !== signer.address ||
    // Freeze authority must be absent (`None`).
    !isNone(mintAccount.data.freezeAuthority)
  ) {
    throw new Error("Post-transaction mint verification failed.");
  }

  // Extract and print durable identifiers only after verification succeeds.
  const signature = getSignatureFromTransaction(signedTransaction);
  console.log(`Mint address: ${mint.address}`);
  console.log(`Transaction signature: ${signature}`);

  // This URL is only for convenient human inspection; it does not verify or
  // modify anything by itself.
  console.log(
    `Explorer: https://explorer.solana.com/address/${mint.address}?cluster=${CLUSTER}`,
  );
}

// Call the entry point. A rejected Promise is forwarded to `catch` so failures
// do not become silent or print an unhelpful raw stack by default.
main().catch((error: unknown) => {
  // `instanceof` safely distinguishes Error objects from other thrown values;
  // the ternary chooses the best printable message for either case.
  console.error(error instanceof Error ? error.message : String(error));

  // Set a non-zero process result for scripts/CI without abruptly skipping
  // Node's remaining cleanup. Removing this could make failures look successful.
  process.exitCode = 1;
});
