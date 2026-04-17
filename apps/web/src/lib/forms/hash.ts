/**
 * Form Data Hash Generator
 * Creates SHA-256 hashes for tamper detection and integrity verification.
 * Uses Web Crypto API (available in Node 18+).
 */

/**
 * Generate a SHA-256 hash of form data for tamper detection.
 * Sorts keys alphabetically to ensure consistent hashing.
 */
export async function generateFormDataHash(
  formData: Record<string, any>
): Promise<string> {
  // Serialize data consistently (sorted keys, minimal whitespace)
  const serialized = JSON.stringify(formData, Object.keys(formData).sort());

  // Create a TextEncoder to convert string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);

  // Generate SHA-256 hash using Web Crypto API
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Verify a form data hash for integrity.
 * Returns true if the hash matches, false otherwise.
 */
export async function verifyFormDataHash(
  formData: Record<string, any>,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await generateFormDataHash(formData);
  return actualHash === expectedHash;
}

/**
 * Generate hash synchronously (fallback for non-async contexts).
 * Note: This is a simple checksum, not cryptographically secure.
 * Use generateFormDataHash for production code.
 */
export function generateFormDataHashSync(
  formData: Record<string, any>
): string {
  const serialized = JSON.stringify(formData, Object.keys(formData).sort());

  // Simple hash using string manipulation
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    const char = serialized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}
