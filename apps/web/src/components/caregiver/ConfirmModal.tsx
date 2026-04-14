'use client';

/**
 * ConfirmModal — reusable confirmation dialog for destructive/important actions.
 * Used for: medication admin confirmation, discharge confirm, handoff sign-off, etc.
 *
 * Variants: danger (red), warning (amber), info (blue)
 */

interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

const VARIANT_BUTTONS: Record<string, string> = {
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  warning: 'bg-amber-600 hover:bg-amber-700 text-white',
  info: 'bg-blue-600 hover:bg-blue-700 text-white',
};

export default function ConfirmModal({
  open, onConfirm, onCancel, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'danger', loading = false,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="p-5">
          <h3 className="text-lg font-bold text-[var(--care-text)]">{title}</h3>
          <p className="text-sm text-[var(--care-text-secondary)] mt-2">{message}</p>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-[var(--care-border)] text-[var(--care-text-secondary)] hover:bg-[var(--care-surface-hover)] transition-colors">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${VARIANT_BUTTONS[variant]} ${
              loading ? 'opacity-50 cursor-not-allowed' : ''
            }`}>
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
