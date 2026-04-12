/**
 * Format number as Indian currency.
 * Examples: 1500 → ₹1,500, 150000 → ₹1,50,000, 10000000 → ₹1,00,00,000
 */
export function formatINR(amount: number): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return formatted;
}

/**
 * Format large numbers in Indian shorthand.
 * Examples: 10000000 → ₹1Cr, 150000 → ₹1.5L, 5000 → ₹5K
 */
export function formatINRShort(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount}`;
}
