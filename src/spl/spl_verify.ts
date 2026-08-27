import { createSolanaRpc, isNone } from "@solana/kit";
import {
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  TOTAL_SUPPLY,
  TOTAL_SUPPLY_BASE_UNITS,
} from "./config";
import {
  formatWholeTokens,
  getRequiredAddressArgument,
} from "./utils";

async function main() {
  const mint = getRequiredAddressArgument("mint", 0);
  const owner = getRequiredAddressArgument("owner", 1);
  const rpc = createSolanaRpc(RPC_URL);
  const mintAccount = await fetchMint(rpc, mint, { commitment: "confirmed" });

  if (mintAccount.programAddress !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("The mint is not owned by the original SPL Token Program.");
  }

  const [ata] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const tokenAccount = await fetchToken(rpc, ata, { commitment: "confirmed" });
  if (tokenAccount.programAddress !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("The ATA is not owned by the original SPL Token Program.");
  }
  if (tokenAccount.data.mint !== mint || tokenAccount.data.owner !== owner) {
    throw new Error("The fetched ATA does not match the expected mint and owner.");
  }

  const supplyMatches = mintAccount.data.supply === TOTAL_SUPPLY_BASE_UNITS;
  const ataHoldsFullSupply = tokenAccount.data.amount === TOTAL_SUPPLY_BASE_UNITS;
  const mintAuthorityRevoked = isNone(mintAccount.data.mintAuthority);
  const freezeAuthorityAbsent = isNone(mintAccount.data.freezeAuthority);
  const decimalsMatch = mintAccount.data.decimals === TOKEN_DECIMALS;

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

  if (
    !decimalsMatch ||
    !supplyMatches ||
    !ataHoldsFullSupply ||
    !mintAuthorityRevoked ||
    !freezeAuthorityAbsent
  ) {
    throw new Error("Verification failed: one or more invariants do not hold.");
  }

  console.log("Verification passed: Rakhi has the intended fixed supply.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
