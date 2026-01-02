import crypto from 'crypto';

/**
 * AES-256-GCM encryption utility for storing sensitive data like IPTV credentials.
 * Uses authenticated encryption to ensure data integrity.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Get or derive the encryption key from environment variables.
 * Falls back to SESSION_SECRET if IPTV_ENCRYPTION_KEY is not set.
 */
function getEncryptionKey(): Buffer {
  const keySource = process.env.IPTV_ENCRYPTION_KEY || process.env.SESSION_SECRET;

  if (!keySource) {
    throw new Error('No encryption key available. Set IPTV_ENCRYPTION_KEY or SESSION_SECRET environment variable.');
  }

  // Use PBKDF2 to derive a consistent key from the source
  return crypto.pbkdf2Sync(keySource, 'iptv-credentials-salt', 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext + auth tag.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine IV + encrypted data + auth tag
  const combined = Buffer.concat([iv, encrypted, authTag]);

  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext that was encrypted with encrypt().
 * Returns the original plaintext string.
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(ciphertext, 'base64');

  // Extract IV, encrypted data, and auth tag
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Check if a string appears to be encrypted (base64 encoded with proper length).
 */
export function isEncrypted(value: string): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    // Minimum length: IV (12) + at least 1 byte of data + auth tag (16) = 29
    return decoded.length >= 29;
  } catch {
    return false;
  }
}

/**
 * Mask a credential for display (show only last 4 characters).
 */
export function maskCredential(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return '****' + value.slice(-4);
}
