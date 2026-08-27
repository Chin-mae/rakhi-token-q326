import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  address,
  createKeyPairSignerFromBytes,
  type Address,
} from "@solana/kit";

export function hasSendApproval(): boolean {
  return process.argv.includes("--send");
}

export function getPositionalArguments(): string[] {
  return process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
}

export function getRequiredAddressArgument(
  label: string,
  position: number,
): Address {
  const value = getPositionalArguments()[position];

  if (!value) {
    throw new Error(`Missing ${label} address.`);
  }

  try {
    return address(value);
  } catch {
    throw new Error(`Invalid ${label} address: ${value}`);
  }
}

export function getRequiredWholeTokenAmount(position: number): bigint {
  const value = getPositionalArguments()[position];

  if (!value || !/^\d+$/.test(value)) {
    throw new Error("Transfer amount must be a positive whole-token integer.");
  }

  const amount = BigInt(value);
  if (amount <= 0n) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  return amount;
}

export async function loadKeypairBytes(): Promise<Uint8Array> {
  const configuredPath = process.env.SOLANA_KEYPAIR_PATH;
  const keypairPath = configuredPath
    ? resolve(configuredPath)
    : resolve(homedir(), ".config", "solana", "id.json");
  const contents = await readFile(keypairPath, "utf8");
  const parsed: unknown = JSON.parse(contents);

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every(
      (value) =>
        Number.isInteger(value) &&
        Number(value) >= 0 &&
        Number(value) <= 255,
    )
  ) {
    throw new Error("The configured keypair file is not a valid 64-byte Solana keypair.");
  }

  return new Uint8Array(parsed as number[]);
}

export async function loadKitSigner() {
  return createKeyPairSignerFromBytes(await loadKeypairBytes());
}

export function formatWholeTokens(amount: bigint): string {
  return amount.toLocaleString("en-US");
}

export async function requireTypedConfirmation(
  confirmationPhrase: string,
): Promise<void> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await prompt.question(
      `Type "${confirmationPhrase}" to sign and broadcast: `,
    );
    if (answer.trim() !== confirmationPhrase) {
      throw new Error("Confirmation did not match. Transaction cancelled.");
    }
  } finally {
    prompt.close();
  }
}
