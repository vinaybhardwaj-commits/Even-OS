'use client';

/**
 * AlertBanner — dismissible alert bar for critical/warning/info messages.
 * Used across all caregiver views for real-time alerts, system messages.
 *
 * Variants: critical (red), warning (amber), info (blue), success (green)
 */

import { useState } from 'react';

interface AlertBannerProps {
  variant: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  message?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const VARIANT_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: '🚨' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: '⚠️' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: 'ℹ️' },
  success: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: '✅' },
};

export default function AlertBanner({ variant, title, message, dismissible = true, onDismiss, action }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const style = VARIANT_STYLES[variant];

  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    onDismiss?.();
  }

  return (
    <div className={`${style.bg} ${style.border} border rounded-xl px-4 py-3`}>
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0 mt-0.5">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${style.text}`}>{title}</div>
          {message && (
            <div className={`text-xs mt-0.5 ${style.text} opacity-75`}>{message}</div>
          )}
        </div>
        {action && (
          <button onClick={action.onClick}
            className={`text-xs font-medium px-3 py-1 rounded-lg ${style.text} bg-white/50 hover:bg-white/80 transition-colors flex-shrink-0`}>
            {action.label}
          </button>
        )}
        {dismissible && (
          <button onClick={handleDismiss}
            className={`${style.text} opacity-50 hover:opacity-100 text-lg leading-none flex-shrink-0`}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}
