'use client';

/**
 * EmptyState — placeholder for empty lists, no-data states.
 * Used when: no patients assigned, no pending tasks, no results.
 */

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon = '📭', title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <span className="text-4xl mb-4">{icon}</span>
      <h3 className="text-base font-semibold text-[var(--care-text)]">{title}</h3>
      {message && (
        <p className="text-sm text-[var(--care-text-muted)] mt-1 text-center max-w-xs">{message}</p>
      )}
      {action && (
        <button onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--care-primary)] text-white hover:opacity-90 transition-opacity">
          {action.label}
        </button>
      )}
    </div>
  );
}
