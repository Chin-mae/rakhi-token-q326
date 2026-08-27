# Rakhi — a fixed-supply SPL token for Raksha Bandhan

> One symbolic RAKHI for every male in the world, inspired by the thread tied between a sister and her brother.

![Rakhi token artwork](assets/rakhi-token.png)

`RAKHI` is an educational fungible SPL token created on **Solana devnet** for **Raksha Bandhan 2026** during the **Turbin3 Q3 Builders Cohort**. The project turns the idea of a rakhi into a fixed digital supply: the complete supply is minted once, after which the mint authority is permanently revoked.

This is a learning project with no promised monetary value, no sale, and no affiliation with the United Nations.

## Token design

| Property | Value |
|---|---|
| Name | Rakhi |
| Symbol | `RAKHI` |
| Network | Solana devnet |
| Token program | Original SPL Token Program |
| Decimals | `6` |
| Whole-token supply | `4,171,512,569 RAKHI` |
| Base-unit supply | `4,171,512,569,000,000` |
| Initial holder | The creator's Associated Token Account (ATA) |
| Mint authority after issuance | None — permanently revoked |
| Freeze authority | None |
| Metadata | Metaplex Token Metadata; update authority retained |

## Why 4,171,512,569?

The supply uses the **2026 worldwide male-population projection** derived from the United Nations, Department of Economic and Social Affairs, Population Division's *World Population Prospects 2024* medium variant:

```text
2026 projected world population:   8,300,678,399
2026 projected male population:    4,171,512,569
2026 projected female population:  4,129,165,830
```

The exact male projection is shown by [PopulationPyramids.org](https://www.populationpyramid.org/), which identifies its source as the UN's *World Population Prospects 2024*. The UN describes the 2024 revision as official estimates through 2023 and projections from 2024 to 2100 in its [World Population Prospects data portal](https://population.un.org/wpp/).

This number is a **dated demographic projection**, not a live count and not a claim that population remains constant.

## What makes the supply fixed?

The final issuance transaction contains three instructions:

1. Create the creator's ATA if it does not already exist.
2. Mint all `4,171,512,569 RAKHI` into that ATA.
3. Set the mint authority to `None`.

Solana transactions are atomic. If any instruction fails, every state change in that transaction is rolled back. If it succeeds, the full supply exists and no authority can mint another RAKHI.

Revoking mint authority does **not** lock the tokens already held in the ATA. Its owner can still transfer or burn them. Burning would reduce the circulating and total supply; it would not restore mint authority.

## Project flow

```text
Create mint
    ↓
Attach Metaplex metadata
    ↓
Create creator ATA + mint full supply + revoke mint authority
    ↓
Verify supply, ATA balance, decimals, and authorities
```

The metadata step happens before revocation because creating the metadata account requires the current mint authority.

## Repository structure

```text
assets/
├── rakhi-token.png       # Token artwork
└── rakhi-token.json      # Off-chain Metaplex metadata
src/spl/
├── config.ts             # One source of truth for token constants
├── utils.ts              # Address validation and secure keypair loading
├── spl_init.ts           # Creates and initializes the mint
├── spl_metadata.ts       # Creates the Metaplex metadata account
├── spl_mint.ts           # Atomically mints and revokes mint authority
├── spl_transfer.ts       # Optional future transfer script
└── spl_verify.ts         # Read-only deployment verification
```

## Safety model

- Every state-changing script defaults to **plan-only mode**.
- A transaction is built and sent only when `--send` is supplied explicitly.
- Every transaction is simulated before submission.
- Simulation happens before signing, and broadcasting requires a typed confirmation phrase.
- All addresses are validated; no cohort member's mint or recipient is hardcoded.
- The wallet keypair is loaded from `SOLANA_KEYPAIR_PATH`, or from the Solana CLI's default `~/.config/solana/id.json` path.
- `devnet-wallet.json`, `*-wallet.json`, `.env*`, and build output are excluded from Git.
- The mint has no freeze authority.
- Mint-authority revocation is permanent and is verified from on-chain state.

Never commit a keypair, seed phrase, private key, or funded mainnet wallet. Use a disposable devnet wallet for this project.

## Setup

Requirements:

- Node.js 20.18 or newer
- npm
- A devnet-funded Solana keypair

Install and type-check:

```bash
npm install
npm run check
```

By default, the scripts use the same keypair as the Solana CLI: `~/.config/solana/id.json`. To select another existing local keypair without copying it into the repository:

```bash
export SOLANA_KEYPAIR_PATH="$HOME/.config/solana/id.json"
```

The scripts never use `devnet-wallet.json` and never print keypair contents. They only display the public address required for transaction review.

## Deployment walkthrough

These commands are intentionally separated so each transaction can be understood and verified before continuing.

### 1. Preview mint initialization

```bash
npm run spl:init
```

After reviewing the plan, initialize the mint:

```bash
npm run spl:init -- --send
```

Record the new mint address printed by the script.

### 2. Preview and create metadata

The repository must already be public so the metadata JSON and image URLs resolve.

```bash
npm run spl:metadata -- <MINT_ADDRESS>
npm run spl:metadata -- <MINT_ADDRESS> --send
```

### 3. Preview the fixed-supply transaction

This is the irreversible issuance step:

```bash
npm run spl:mint -- <MINT_ADDRESS>
```

Review the mint, fee payer, destination ATA, amount, cluster, and permanent authority removal. Then send only after explicit confirmation:

```bash
npm run spl:mint -- <MINT_ADDRESS> --send
```

### 4. Verify the result

Verification is read-only and does not require a private key:

```bash
npm run spl:verify -- <MINT_ADDRESS> <OWNER_WALLET_ADDRESS>
```

It checks that:

- decimals equal `6`;
- supply equals `4,171,512,569,000,000` base units;
- the creator's ATA holds the complete initial supply;
- mint authority is absent; and
- freeze authority is absent.

### Optional future transfer

No transfers are part of the initial deployment. When desired later, preview a whole-token transfer with:

```bash
npm run spl:transfer -- <MINT_ADDRESS> <RECIPIENT_WALLET> <WHOLE_TOKEN_AMOUNT>
```

Adding `--send` submits that reviewed transfer. Removing mint authority does not prevent existing RAKHI from being transferred.

## Devnet deployment evidence

Deployment completed and independently verified on **28 August 2026**.

| Item | Value |
|---|---|
| Creator wallet | [`GzxbTnf...GNUHapJ`](https://explorer.solana.com/address/GzxbTnfFevizoZChrcG5RtKBZw3THEEXBgcbiGNUHapJ?cluster=devnet) |
| Mint address | [`GzCRW7HH...AbjuSbMB`](https://explorer.solana.com/address/GzCRW7HH51eYrZRNVitjidUUg81Tie7kC9P5AbjuSbMB?cluster=devnet) |
| Creator ATA | [`GSaUGZ4X...MWXTDcXi`](https://explorer.solana.com/address/GSaUGZ4X5a5wuv8YiQc2VTVdUr7dquTL6mTYMWXTDcXi?cluster=devnet) |
| Mint initialization transaction | [`4LLUVyUy...dLpPj8zE`](https://explorer.solana.com/tx/4LLUVyUyMvxAT3MkiiSgkgrJwMf8gU3dUBk6dEXJvVV3GhLnkpH96xwbzxYAeNavXkNL5camFSRhMeYbdLpPj8zE?cluster=devnet) |
| Metadata transaction | [`2u68L9SQ...MYa54DKp`](https://explorer.solana.com/tx/2u68L9SQyW1EvjVCG4RtB6YeTcQoSNHhacUT1d8V5reYcVnFfkPqdKAi4x6y3nibWxB71oTc6HYXZ2UFMYa54DKp?cluster=devnet) |
| Fixed-supply mint transaction | [`3uektXNM...HM1UgoX1`](https://explorer.solana.com/tx/3uektXNM1sEZ27SgR92brsdqa4CaJkqL4szKQSw61WpzLxPTqyMMBKsRq3BM7bo567qq57Cjr3TmL2cWHM1UgoX1?cluster=devnet) |
| Verified supply | `4,171,512,569 RAKHI` (`4,171,512,569,000,000` base units) |
| Creator ATA balance at verification | `4,171,512,569 RAKHI` |
| Mint authority | None — permanently revoked |
| Freeze authority | None |

Re-run the read-only verification at any time:

```bash
npm run spl:verify -- GzCRW7HH51eYrZRNVitjidUUg81Tie7kC9P5AbjuSbMB GzxbTnfFevizoZChrcG5RtKBZw3THEEXBgcbiGNUHapJ
```

## Security implications

Mint-authority revocation cannot be undone. If the amount, decimals, destination ATA, or mint address is wrong when the final transaction succeeds, no additional RAKHI can be minted to correct the mistake. That is why the project uses centralized constants, checked instructions, simulation, explicit `--send` gates, and post-transaction verification.

Metadata remains mutable so broken artwork or JSON links can be repaired by the update authority. This does not allow the token supply to change.

## Acknowledgements

- Built as part of the [Turbin3](https://turbin3.com/) Q3 Builders Cohort.
- Based on the cohort starter repository by [ShrinathNR](https://github.com/ShrinathNR/spl-nft-q326).
- Presentation inspired by [bwaj95's Onam Mahabali Homecoming token](https://github.com/bwaj95/spl-nft-q326).
- Population source: United Nations DESA Population Division, *World Population Prospects 2024*.

---

Made to celebrate the bond represented by a rakhi — expressed here as an educational, fixed-supply token on Solana devnet.
