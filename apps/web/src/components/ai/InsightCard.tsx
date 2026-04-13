'use client';

import { useState } from 'react';
import { ChevronDown, Zap, MoreVertical } from 'lucide-react';

interface InsightCardData {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  module: string;
  title: string;
  body: string;
  source: 'ai' | 'template';
  confidence: number;
  created_at: string;
  explanation?: string;
  data_sources?: string[];
}

interface InsightCardProps {
  card: InsightCardData;
  onDismiss: (id: string) => void;
  onAct: (id: string) => void;
  onFeedback: (id: string, score: 1 | -1) => void;
}

const severityConfig = {
  critical: { color: 'border-red-600', bg: 'bg-red-50', badge: 'bg-red-600 text-white', label: 'Critical' },
  high: { color: 'border-orange-600', bg: 'bg-orange-50', badge: 'bg-orange-600 text-white', label: 'High' },
  medium: { color: 'border-yellow-600', bg: 'bg-yellow-50', badge: 'bg-yellow-600 text-white', label: 'Medium' },
  low: { color: 'border-violet-600', bg: 'bg-violet-50', badge: 'bg-violet-600 text-white', label: 'Low' },
};

function timeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function InsightCard({ card, onDismiss, onAct, onFeedback }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<1 | -1 | null>(null);
  const config = severityConfig[card.severity];

  const handleFeedback = (score: 1 | -1) => {
    setFeedback(score);
    onFeedback(card.id, score);
  };

  const bodyLines = card.body.split('\n');
  const isBodyTruncated = bodyLines.length > 3;
  const displayBody = isBodyTruncated ? bodyLines.slice(0, 3).join('\n') : card.body;

  return (
    <div className={`${config.color} border-l-4 ${config.bg} rounded-lg p-4 mb-3`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${config.badge} text-xs px-2 py-1 rounded font-medium`}>
              {config.label}
            </span>
            <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
              {card.module}
            </span>
          </div>
          <h3 className="font-semibold text-sm text-gray-900 mb-1">{card.title}</h3>
        </div>
        <button
          onClick={() => onDismiss(card.id)}
          className="text-gray-400 hover:text-gray-600 transition"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap line-clamp-3">{displayBody}</p>

      {/* Source & Confidence */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {card.source === 'ai' ? (
            <span className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded">
              🤖 AI
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
              📋 Template
            </span>
          )}
          <span className="text-xs text-gray-500">{timeAgo(card.created_at)}</span>
        </div>
      </div>

      {/* Confidence Bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600">Confidence</span>
          <span className="text-xs font-medium text-emerald-600">{Math.round(card.confidence * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-emerald-600 h-1.5 rounded-full"
            style={{ width: `${card.confidence * 100}%` }}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded text-violet-600 hover:bg-violet-100 transition"
        >
          <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
          Show reasoning
        </button>
        <button
          onClick={() => onAct(card.id)}
          className="text-xs px-2 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700 transition"
        >
          Act
        </button>
      </div>

      {/* Expanded Reasoning */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          {card.explanation && (
            <div className="mb-3">
              <p className="text-xs text-gray-600 mb-1 font-medium">Explanation</p>
              <p className="text-xs text-gray-700">{card.explanation}</p>
            </div>
          )}

          {card.data_sources && card.data_sources.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-600 mb-1 font-medium">Data Sources</p>
              <div className="flex flex-wrap gap-1">
                {card.data_sources.map((source, idx) => (
                  <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                    {source}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Feedback Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Helpful?</span>
            <button
              onClick={() => handleFeedback(1)}
              className={`text-xs px-2 py-1 rounded transition ${
                feedback === 1 ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-600'
              }`}
            >
              👍 Yes
            </button>
            <button
              onClick={() => handleFeedback(-1)}
              className={`text-xs px-2 py-1 rounded transition ${
                feedback === -1 ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100 text-gray-600'
              }`}
            >
              👎 No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
