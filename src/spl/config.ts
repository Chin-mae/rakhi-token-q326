export const CLUSTER = "devnet";
export const RPC_URL = "https://api.devnet.solana.com";
export const RPC_SUBSCRIPTIONS_URL = "wss://api.devnet.solana.com";

export const TOKEN_NAME = "Rakhi";
export const TOKEN_SYMBOL = "RAKHI";
export const TOKEN_DECIMALS = 6;

// UN World Population Prospects 2024, medium projection for 2026.
export const TOTAL_SUPPLY = 4_171_512_569n;
export const BASE_UNITS_PER_TOKEN = 10n ** BigInt(TOKEN_DECIMALS);
export const TOTAL_SUPPLY_BASE_UNITS =
  TOTAL_SUPPLY * BASE_UNITS_PER_TOKEN;

export const TOKEN_METADATA_URI =
  "https://raw.githubusercontent.com/Chin-mae/rakhi-token-q326/main/assets/rakhi-token.json";
