/**
 * SHARED SPL-TOKEN SETTINGS
 *
 * This file contains data, not a transaction. Importing it does not create,
 * mint, or transfer a token. The other SPL scripts import these values so the
 * token name, supply, decimals, and network cannot accidentally disagree.
 *
 * Beginner syntax used below:
 * - `export` makes a value available to other files. Without it, an importing
 *   file cannot use that value.
 * - `const` creates a variable whose binding cannot later be reassigned. This
 *   protects configuration from accidental changes while a script is running.
 * - `=` stores the value on the right under the name on the left.
 * - A quoted value is a string (text); an unquoted number is numeric data.
 * - `;` ends a TypeScript statement. The formatter/compiler can often infer
 *   it, but keeping it makes statement boundaries obvious.
 */

// The Solana cluster is the independent network we intend to use.
// `devnet` holds test data and test SOL; changing this without also changing
// the URLs below could make logs claim one network while contacting another.
export const CLUSTER = "devnet";

// RPC means Remote Procedure Call. Scripts send read/write requests to this
// HTTPS endpoint. Without an RPC URL, they cannot communicate with Solana.
export const RPC_URL = "https://api.devnet.solana.com";

// This WebSocket (`wss`) endpoint delivers confirmation updates over a lasting
// connection. The send-and-confirm helpers need it to observe transactions.
export const RPC_SUBSCRIPTIONS_URL = "wss://api.devnet.solana.com";

// Human-readable token name shown by wallets and explorers that load metadata.
export const TOKEN_NAME = "Rakhi";

// Short ticker-like label. It is presentation data, not a unique identifier;
// the mint address is what uniquely identifies this token on Solana.
export const TOKEN_SYMBOL = "RAKHI";

// Six decimals means one displayed RAKHI equals 1,000,000 indivisible base
// units. Removing or changing this would change how raw balances are displayed.
export const TOKEN_DECIMALS = 6;

// UN World Population Prospects 2024, medium projection for 2026.
// The `_` characters only improve readability; TypeScript treats this as the
// integer 4171512569. The `n` makes it a `bigint`, which safely represents
// exact on-chain integers without JavaScript floating-point rounding.
export const TOTAL_SUPPLY = 4_171_512_569n;

// `10n ** BigInt(TOKEN_DECIMALS)` means 10 raised to the decimal count. Here it
// produces 1,000,000 base units per displayed token. `BigInt(...)` converts the
// ordinary number to the same exact-integer type used by `10n`.
export const BASE_UNITS_PER_TOKEN = 10n ** BigInt(TOKEN_DECIMALS);

// Solana instructions work with base units, so multiplication converts the
// intended human supply into its raw on-chain amount. Without this conversion,
// minting 4,171,512,569 would display as only 4,171.512569 RAKHI.
export const TOTAL_SUPPLY_BASE_UNITS =
  TOTAL_SUPPLY * BASE_UNITS_PER_TOKEN;

// This HTTPS URL points to the off-chain JSON that describes the fungible
// token. The blockchain metadata account stores the URL, not the full image.
export const TOKEN_METADATA_URI =
  "https://raw.githubusercontent.com/Chin-mae/rakhi-token-q326/main/assets/rakhi-token.json";
