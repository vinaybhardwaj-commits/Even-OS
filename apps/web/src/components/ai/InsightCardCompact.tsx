'use client';

import { ChevronRight, X } from 'lucide-react';

interface InsightCardCompactData {
  id: string;
  title: string;
  metric: string;
}

interface InsightCardCompactProps {
  card: InsightCardCompactData;
  onDismiss: (id: string) => void;
  onExpand: (id: string) => void;
}

export function InsightCardCompact({ card, onDismiss, onExpand }: InsightCardCompactProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-violet-50 border-l-2 border-violet-600 hover:bg-violet-100 transition">
      <div className="text-lg">🤖</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{card.title}</p>
        <p className="text-xs text-violet-600">{card.metric}</p>
      </div>
      <button
        onClick={() => onExpand(card.id)}
        className="text-gray-400 hover:text-violet-600 transition p-1"
        title="View details"
      >
        <ChevronRight size={16} />
      </button>
      <button
        onClick={() => onDismiss(card.id)}
        className="text-gray-400 hover:text-red-600 transition p-1"
        title="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
