/**
 * Strip PII from error messages before logging.
 * Patterns: Indian phone numbers, email addresses, Aadhaar numbers.
 */
export function stripPII(message: string): string {
  return message
    // Indian phone numbers (10 digits, with or without +91/0 prefix)
    .replace(/(\+91[\-\s]?)?[6-9]\d{9}/g, '[PHONE_REDACTED]')
    // Email addresses
    .replace(/[\w.-]+@[\w.-]+\.\w{2,}/g, '[EMAIL_REDACTED]')
    // Aadhaar numbers (12 digits with optional spaces/dashes)
    .replace(/\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, '[AADHAAR_REDACTED]')
    // Policy numbers (common formats)
    .replace(/\b[A-Z]{2,5}\/\d{6,12}\b/g, '[POLICY_REDACTED]');
}
