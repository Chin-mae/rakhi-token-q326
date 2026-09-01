/**
 * READ-ONLY SPL VERIFICATION
 *
 * This script proves that an existing mint and owner's Associated Token Account
 * match the intended fixed-supply RAKHI state. It does not load a wallet, build
 * a transaction, sign, charge a fee, or modify Solana.
 *
 * An "invariant" is a condition that must remain true. Here the invariants are:
 * correct program ownership, decimals, total supply, owner/mint relationship,
 * full supply in the expected ATA, no mint authority, and no freeze authority.
 */

// RPC creation lets us read chain state; `isNone` checks absent authorities.
import { createSolanaRpc, isNone } from "@solana/kit";

// Token Program readers/derivation decode the two relevant account types.
import {
  // Reads the mint definition (supply, decimals, authorities).
  fetchMint,
  // Reads the balance-holding token account.
  fetchToken,
  // Recomputes the deterministic ATA address from mint + owner.
  findAssociatedTokenPda,
  // Existing original SPL Token Program address expected to own both accounts.
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// Expected project constants used as the verification reference.
import {
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  TOTAL_SUPPLY,
  TOTAL_SUPPLY_BASE_UNITS,
} from "./config";

// Helpers format output and reject missing/malformed addresses.
import {
  formatWholeTokens,
  getRequiredAddressArgument,
} from "./utils";

// `async` enables awaited RPC reads. `main` returns no explicit value.
async function main() {
  // Argument 0 identifies the mint; argument 1 identifies the expected owner.
  const mint = getRequiredAddressArgument("mint", 0);
  const owner = getRequiredAddressArgument("owner", 1);

  // Constructing a client is local; the fetch below is the first network read.
  const rpc = createSolanaRpc(RPC_URL);

  // Fetch and decode the mint at confirmed commitment.
  const mintAccount = await fetchMint(rpc, mint, { commitment: "confirmed" });

  // On Solana, an account's owner program controls how its data is interpreted.
  // This prevents decoding an arbitrary same-sized account as an SPL mint.
  if (mintAccount.programAddress !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("The mint is not owned by the original SPL Token Program.");
  }

  // Derive rather than trust a supplied token-account address. Array
  // destructuring keeps the first returned value, the ATA public address.
  const [ata] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Read the expected balance account. It must exist for verification to pass.
  const tokenAccount = await fetchToken(rpc, ata, { commitment: "confirmed" });

  // Verify the account is controlled by the expected token-program variant.
  if (tokenAccount.programAddress !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("The ATA is not owned by the original SPL Token Program.");
  }

  // Prove its internal mint and owner fields match the derivation inputs. `||`
  // rejects if either relationship is wrong.
  if (tokenAccount.data.mint !== mint || tokenAccount.data.owner !== owner) {
    throw new Error("The fetched ATA does not match the expected mint and owner.");
  }

  // Each strict equality expression evaluates to a boolean for later display and
  // one combined pass/fail decision. bigint equality stays exact.
  const supplyMatches = mintAccount.data.supply === TOTAL_SUPPLY_BASE_UNITS;
  const ataHoldsFullSupply = tokenAccount.data.amount === TOTAL_SUPPLY_BASE_UNITS;

  // Optional authority fields use a tagged Option, so `isNone` is safer than
  // guessing whether absence is represented by null or undefined.
  const mintAuthorityRevoked = isNone(mintAccount.data.mintAuthority);
  const freezeAuthorityAbsent = isNone(mintAccount.data.freezeAuthority);
  const decimalsMatch = mintAccount.data.decimals === TOKEN_DECIMALS;

  // These logs expose both expected values and raw account values so a learner
  // can see what is being compared rather than receiving only pass/fail.
  console.log(`Mint: ${mint}`);
  console.log(`Owner: ${owner}`);
  console.log(`ATA: ${ata}`);
  console.log(`Expected supply: ${formatWholeTokens(TOTAL_SUPPLY)} ${TOKEN_SYMBOL}`);
  console.log(`Raw on-chain supply: ${mintAccount.data.supply}`);
  console.log(`Raw ATA balance: ${tokenAccount.data.amount}`);
  console.log(`Decimals correct: ${decimalsMatch}`);
  console.log(`Supply correct: ${supplyMatches}`);
  console.log(`ATA holds full supply: ${ataHoldsFullSupply}`);
  console.log(`Mint authority revoked: ${mintAuthorityRevoked}`);
  console.log(`Freeze authority absent: ${freezeAuthorityAbsent}`);

  // `!` negates each condition, and `||` means one failed invariant fails the
  // complete verification. Removing any term weakens what "passed" guarantees.
  if (
    !decimalsMatch ||
    !supplyMatches ||
    !ataHoldsFullSupply ||
    !mintAuthorityRevoked ||
    !freezeAuthorityAbsent
  ) {
    throw new Error("Verification failed: one or more invariants do not hold.");
  }

  // This line runs only after every invariant above has evaluated true.
  console.log("Verification passed: Rakhi has the intended fixed supply.");
}

// Report network/validation failures and make the command exit unsuccessfully.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
