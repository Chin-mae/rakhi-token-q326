/**
 * REUSABLE SAFETY AND INPUT HELPERS
 *
 * A helper is a small function used by several scripts. Centralising these
 * rules prevents each transaction file from parsing addresses, loading the
 * wallet, and asking for confirmation differently.
 *
 * Security boundary: `loadKeypairBytes` reads secret key material. The bytes
 * are returned only to code that constructs a signer; this file never prints
 * them. Anyone with those 64 bytes can control the wallet, so never add a
 * `console.log` for `contents`, `parsed`, the byte array, or the keypair.
 */

// `import` brings an exported tool from another module into this file.
// This asynchronous (`promises`) version of `readFile` lets `await` pause until
// the wallet file has been read instead of blocking the whole Node.js process.
import { readFile } from "node:fs/promises";

// `homedir()` returns the current operating-system user's home directory. It
// lets the code find the standard Solana CLI wallet without hard-coding a name.
import { homedir } from "node:os";

// `resolve` turns path pieces into an absolute, normalised filesystem path.
import { resolve } from "node:path";

// `createInterface` provides the terminal question used for typed approval.
import { createInterface } from "node:readline/promises";

// Curly braces select named exports from the `@solana/kit` package.
import {
  // Validates text and brands it as a Solana address.
  address,
  // Converts 64 validated secret bytes into a signer object.
  createKeyPairSignerFromBytes,
  // `type` imports only a TypeScript compile-time shape; it produces no
  // JavaScript and costs nothing at runtime.
  type Address,
} from "@solana/kit";

/** Return `true` only when the command line contains the explicit `--send` flag.
 * `function` defines reusable behaviour; `(): boolean` says it accepts no
 * arguments and must return true/false. Removing this guard from callers could
 * turn a preview command into a real blockchain write.
 */
export function hasSendApproval(): boolean {
  // `process.argv` is the list of command-line words. `includes` performs an
  // exact search, and `return` sends the result back to the calling code.
  return process.argv.includes("--send");
}

/** Return only non-flag command-line arguments.
 * `string[]` means an array (ordered list) containing strings.
 */
export function getPositionalArguments(): string[] {
  // `slice(2)` drops the Node executable and script path. `filter` keeps values
  // for which the arrow function returns true. `!` means "not", so arguments
  // starting with `--` are excluded from positional input.
  return process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
}

/** Read and validate one required Solana address from the command line.
 * `label` makes errors human-readable; `position` selects which argument.
 */
export function getRequiredAddressArgument(
  // Both parameters are annotated with their required TypeScript types.
  label: string,
  position: number,
): Address {
  // Bracket notation retrieves one item from the positional-argument array.
  // `const` prevents this selected input from being reassigned accidentally.
  const value = getPositionalArguments()[position];

  // An empty or missing string is "falsy"; `!value` detects that case early.
  if (!value) {
    // `throw` stops normal execution. A template literal (backticks) inserts
    // `${label}` into the message so the user knows which address is absent.
    throw new Error(`Missing ${label} address.`);
  }

  // `try` runs code that may fail; its matching `catch` handles that failure.
  try {
    // This rejects malformed public-key text and returns Kit's `Address` type.
    return address(value);
  } catch {
    // Converting failure into a labelled error is safer than letting an opaque
    // library error continue or accepting an unintended recipient/mint.
    throw new Error(`Invalid ${label} address: ${value}`);
  }
}

/** Read a positive whole-token amount and return it as an exact `bigint`. */
export function getRequiredWholeTokenAmount(position: number): bigint {
  // The requested positional argument arrives as text from the shell.
  const value = getPositionalArguments()[position];

  // `||` means OR. The regular expression `/^\d+$/` accepts only one or more
  // digits from start (`^`) to end (`$`); `.test` checks for that pattern.
  if (!value || !/^\d+$/.test(value)) {
    // Rejecting signs, decimals, and non-numbers prevents ambiguous transfers.
    throw new Error("Transfer amount must be a positive whole-token integer.");
  }

  // Convert text to exact integer arithmetic. Ordinary JavaScript `number`
  // values can lose precision at large token amounts.
  const amount = BigInt(value);

  // `<=` means less than or equal to. `0n` is bigint zero.
  if (amount <= 0n) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  // Only a validated, positive amount reaches the caller.
  return amount;
}

/** Load and validate the Solana CLI keypair bytes.
 * `async` permits `await`; `Promise<Uint8Array>` means the eventual result is a
 * byte array. Removing validation could pass corrupt or malicious data into a
 * signer constructor.
 */
export async function loadKeypairBytes(): Promise<Uint8Array> {
  // Environment variables are runtime settings. This optional value allows a
  // deliberate wallet override without modifying source code.
  const configuredPath = process.env.SOLANA_KEYPAIR_PATH;

  // The ternary `condition ? a : b` chooses the configured path when present,
  // otherwise the standard `~/.config/solana/id.json` CLI wallet.
  const keypairPath = configuredPath
    ? resolve(configuredPath)
    : resolve(homedir(), ".config", "solana", "id.json");

  // `await` pauses this function until UTF-8 text is read or an error occurs.
  const contents = await readFile(keypairPath, "utf8");

  // JSON.parse turns the file's JSON text into JavaScript data. `unknown` is a
  // safe type: code must validate the result before treating it as byte data.
  const parsed: unknown = JSON.parse(contents);

  // This compound condition rejects anything that is not exactly 64 bytes.
  // `||` means any failed requirement is enough to reject the file.
  if (
    // The JSON root must be an array...
    !Array.isArray(parsed) ||
    // ...the array must contain the 64-byte Solana keypair representation...
    parsed.length !== 64 ||
    // ...and `every` item must pass all (`&&`) integer/range checks.
    !parsed.every(
      (value) =>
        Number.isInteger(value) &&
        Number(value) >= 0 &&
        Number(value) <= 255,
    )
  ) {
    // Stopping here prevents invalid secret material from becoming a signer.
    throw new Error("The configured keypair file is not a valid 64-byte Solana keypair.");
  }

  // `as number[]` is safe only because the checks above proved the shape.
  // Uint8Array is the byte-container format expected by cryptography helpers.
  return new Uint8Array(parsed as number[]);
}

/** Convert the validated wallet bytes into a Solana Kit signer.
 * The inferred return type includes both the public address and signing power.
 */
export async function loadKitSigner() {
  // Inner `await` gets bytes first; the outer function returns the created
  // signer. Removing `await` would pass a Promise instead of actual bytes.
  return createKeyPairSignerFromBytes(await loadKeypairBytes());
}

/** Format a whole-token bigint with commas for human-readable summaries. */
export function formatWholeTokens(amount: bigint): string {
  // The locale affects display only; it does not change the numeric amount.
  return amount.toLocaleString("en-US");
}

/** Require an exact phrase before a caller signs and broadcasts.
 * `Promise<void>` means the asynchronous function succeeds without returning a
 * value, or throws if approval is wrong. This is a human safety checkpoint.
 */
export async function requireTypedConfirmation(
  confirmationPhrase: string,
): Promise<void> {
  // Connect a readline interface to terminal input and output.
  const prompt = createInterface({
    // stdin receives what the user types.
    input: process.stdin,
    // stdout displays the question.
    output: process.stdout,
  });

  // `finally` below will run whether this block succeeds or throws.
  try {
    // Wait for an answer. `${confirmationPhrase}` makes every dangerous action
    // demand its own explicit wording instead of a generic yes/no.
    const answer = await prompt.question(
      `Type "${confirmationPhrase}" to sign and broadcast: `,
    );

    // `trim()` ignores accidental outer whitespace; `!==` means "not exactly
    // equal". A mismatch cancels before the calling code can broadcast.
    if (answer.trim() !== confirmationPhrase) {
      throw new Error("Confirmation did not match. Transaction cancelled.");
    }
  } finally {
    // Always release the terminal interface. Without this, Node may remain open
    // waiting for input even after success or failure.
    prompt.close();
  }
}
