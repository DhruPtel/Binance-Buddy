// =============================================================================
// @binancebuddy/blockchain — Agent Keystore
// AES-256-GCM encryption for private key storage.
// Key derivation: scrypt(password, salt) → 32-byte AES key.
//
// Flow:
//   1. Check AGENT_WALLET_PRIVATE_KEY env — use directly if set
//   2. Check .agent-keystore.json — decrypt with KEYSTORE_PASSWORD if exists
//   3. Generate new wallet, print to console, encrypt and save
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const SALT_LEN = 32;
const IV_LEN = 16;
const KEY_LEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const DEFAULT_KEYSTORE_PATH = '.agent-keystore.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeystoreFile {
  version: 1;
  address: string;
  iv: string;       // hex
  authTag: string;  // hex
  ciphertext: string; // hex
  salt: string;     // hex
  createdAt: number;
}

export interface AgentWalletInfo {
  wallet: ethers.Wallet;
  address: string;
  privateKey: string;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a private key with AES-256-GCM using scrypt key derivation.
 */
export function encryptPrivateKey(privateKey: string, password: string): KeystoreFile {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const wallet = new ethers.Wallet(privateKey);

  return {
    version: 1,
    address: wallet.address,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    salt: salt.toString('hex'),
    createdAt: Date.now(),
  };
}

/**
 * Decrypt a keystore file to recover the private key.
 * Throws if the password is wrong (GCM auth tag mismatch).
 */
export function decryptPrivateKey(ks: KeystoreFile, password: string): string {
  const salt = Buffer.from(ks.salt, 'hex');
  const iv = Buffer.from(ks.iv, 'hex');
  const authTag = Buffer.from(ks.authTag, 'hex');
  const ciphertext = Buffer.from(ks.ciphertext, 'hex');

  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function saveKeystore(ks: KeystoreFile, filePath = DEFAULT_KEYSTORE_PATH): void {
  writeFileSync(filePath, JSON.stringify(ks, null, 2), 'utf8');
}

export function loadKeystore(filePath = DEFAULT_KEYSTORE_PATH): KeystoreFile | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as KeystoreFile;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main: getOrCreateAgentWallet
// ---------------------------------------------------------------------------

/**
 * Load or create the agent wallet.
 *
 * Priority:
 *   1. AGENT_WALLET_PRIVATE_KEY env → use directly (no file I/O)
 *   2. .agent-keystore.json exists → decrypt with KEYSTORE_PASSWORD
 *   3. Neither → generate new wallet, save keystore, print key to console
 */
export function getOrCreateAgentWallet(
  provider: ethers.Provider,
  keystorePath = DEFAULT_KEYSTORE_PATH,
): AgentWalletInfo {
  const envKey = process.env.AGENT_WALLET_PRIVATE_KEY;
  const password = process.env.KEYSTORE_PASSWORD ?? 'binancebuddy-dev';

  // 1. Env key present — use directly
  if (envKey && envKey.startsWith('0x') && envKey.length === 66) {
    const wallet = new ethers.Wallet(envKey, provider);
    return { wallet, address: wallet.address, privateKey: envKey, isNew: false };
  }

  // 2. Keystore file exists — decrypt
  const existing = loadKeystore(keystorePath);
  if (existing) {
    try {
      const privateKey = decryptPrivateKey(existing, password);
      const wallet = new ethers.Wallet(privateKey, provider);
      return { wallet, address: wallet.address, privateKey, isNew: false };
    } catch {
      console.error('[keystore] Failed to decrypt keystore — wrong KEYSTORE_PASSWORD?');
      // Fall through to generate new
    }
  }

  // 3. Generate new wallet
  // createRandom() returns HDNodeWallet — reconstruct a plain Wallet from private key
  const hdWallet = ethers.Wallet.createRandom();
  const privateKey = hdWallet.privateKey;
  const ks = encryptPrivateKey(privateKey, password);
  saveKeystore(ks, keystorePath);

  const wallet = new ethers.Wallet(privateKey, provider);

  console.log('\n  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║         NEW AGENT WALLET GENERATED — SAVE THIS!         ║');
  console.log('  ╠══════════════════════════════════════════════════════════╣');
  console.log(`  ║  Address:     ${wallet.address}  ║`);
  console.log(`  ║  Private Key: ${privateKey}  ║`);
  console.log('  ╠══════════════════════════════════════════════════════════╣');
  console.log('  ║  Fund this address with BNB before executing any swaps. ║');
  console.log('  ║  Key encrypted to .agent-keystore.json                  ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝\n');

  return {
    wallet,
    address: wallet.address,
    privateKey,
    isNew: true,
  };
}
