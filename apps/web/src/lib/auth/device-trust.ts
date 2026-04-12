/**
 * Device trust management — cookie-based device binding.
 *
 * Flow:
 * 1. On login, check for `device_trust` cookie
 * 2. If present → extract device_id → check against trusted_devices table
 * 3. If trusted → proceed with login
 * 4. If NOT trusted → require email OTP verification
 * 5. After OTP verified → set cookie + add device to trusted_devices
 */

import { cookies } from 'next/headers';
import crypto from 'crypto';

const DEVICE_COOKIE = 'even_device_trust';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

/**
 * Generate a random device ID
 */
export function generateDeviceId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a 6-digit OTP code
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash a code for storage (one-way)
 */
export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Get the device ID from the trust cookie, if present
 */
export async function getDeviceId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(DEVICE_COOKIE);
    if (!cookie?.value) return null;

    // The cookie value is the device_id directly (encrypted in production with ENCRYPTION_KEY)
    return decryptDeviceId(cookie.value);
  } catch {
    return null;
  }
}

/**
 * Set the device trust cookie with an encrypted device ID
 */
export async function setDeviceTrustCookie(deviceId: string): Promise<void> {
  const cookieStore = await cookies();
  const encrypted = encryptDeviceId(deviceId);

  cookieStore.set(DEVICE_COOKIE, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * Clear the device trust cookie
 */
export async function clearDeviceTrustCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(DEVICE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
}

/**
 * Parse a user-agent string into a readable device name
 */
export function parseUserAgent(ua?: string): { deviceName: string; browser: string; os: string } {
  if (!ua) return { deviceName: 'Unknown Device', browser: 'Unknown', os: 'Unknown' };

  let browser = 'Unknown';
  let os = 'Unknown';

  // OS detection
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  // Browser detection
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';

  return {
    deviceName: `${browser} on ${os}`,
    browser,
    os,
  };
}

// --- Encryption helpers ---

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || 'default-dev-key-1234567890abcdef';
  // Use first 32 bytes of SHA-256 hash of the key for AES-256
  return crypto.createHash('sha256').update(key).digest();
}

function encryptDeviceId(deviceId: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(deviceId, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptDeviceId(encrypted: string): string | null {
  try {
    const key = getEncryptionKey();
    const [ivHex, data] = encrypted.split(':');
    if (!ivHex || !data) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}
