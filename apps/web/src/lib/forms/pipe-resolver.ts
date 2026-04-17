/**
 * Pipe Resolver
 * Resolve {{fieldId}} and {{fieldId|formatter}} tokens in strings.
 * Supports piping field values and formatting them.
 */

/**
 * Resolve all pipe tokens in a template string.
 * Syntax: {{fieldId}} or {{fieldId|formatter}}
 * Formatters: currency, uppercase, lowercase, number, date, datetime
 */
export function resolvePipeTokens(
  template: string,
  formData: Record<string, any>
): string {
  if (!template || typeof template !== 'string') {
    return template;
  }

  return template.replace(
    /\{\{([^}|]+)(?:\|([^}]+))?\}\}/g,
    (match, fieldId, formatter) => {
      const value = formData[fieldId];
      if (value === undefined || value === null) {
        return '';
      }

      if (formatter) {
        return formatValue(value, formatter.trim());
      }

      return String(value);
    }
  );
}

/**
 * Format a value using the specified formatter.
 */
function formatValue(value: any, formatter: string): string {
  switch (formatter.toLowerCase()) {
    case 'currency':
      return formatCurrency(value);

    case 'uppercase':
      return String(value).toUpperCase();

    case 'lowercase':
      return String(value).toLowerCase();

    case 'number':
      return formatNumber(value);

    case 'date':
      return formatDate(value);

    case 'datetime':
      return formatDateTime(value);

    case 'phone':
      return formatPhone(value);

    case 'percent':
      return `${formatNumber(value)}%`;

    default:
      return String(value);
  }
}

/**
 * Format a number as currency (INR).
 */
function formatCurrency(value: any): string {
  const num = Number(value);
  if (isNaN(num)) return '';

  // Indian currency format: 1,00,000
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Format a number with 2 decimal places.
 */
function formatNumber(value: any): string {
  const num = Number(value);
  if (isNaN(num)) return '';

  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a date (ISO string or Date object) as DD/MM/YYYY.
 */
function formatDate(value: any): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
}

/**
 * Format a date as DD/MM/YYYY HH:MM.
 */
function formatDateTime(value: any): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return '';
  }
}

/**
 * Format a phone number: +91 98765 43210
 */
function formatPhone(value: any): string {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10) return '';

  const last10 = digits.slice(-10);
  return `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
}
