/**
 * Normalize phone number to last 10 digits.
 * Handles: +91-98765-43210, 098765 43210, 9876543210, etc.
 * Returns null if input doesn't contain a valid 10-digit Indian mobile number.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  // Indian mobile numbers start with 6-9
  if (!/^[6-9]/.test(last10)) return null;
  return last10;
}
