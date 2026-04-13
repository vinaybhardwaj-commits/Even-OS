'use client';

import { useState, useEffect } from 'react';
import { X, ChevronDown, Loader } from 'lucide-react';

interface BriefingData {
  id: string;
  content: string;
  generated_at: string;
  source: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function MorningBriefing() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const loadBriefing = async () => {
      setLoading(true);
      try {
        const data = await trpcQuery('evenAI.getMorningBriefing');
        setBriefing(data);
      } catch (error) {
        console.error('Failed to load morning briefing:', error);
      } finally {
        setLoading(false);
      }
    };

    loadBriefing();
  }, []);

  const handleDismiss = async () => {
    if (briefing) {
      try {
        await trpcMutate('evenAI.dismissBriefing', { briefing_id: briefing.id });
      } catch (error) {
        console.error('Failed to dismiss briefing:', error);
      }
    }
    setDismissed(true);
  };

  if (dismissed || !briefing) {
    return null;
  }

  const lines = briefing.content.split('\n').filter(l => l.trim());
  const today = formatDate(new Date());

  return (
    <div className="bg-white border border-violet-200 rounded-lg overflow-hidden shadow-sm mb-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-50 to-violet-100 border-l-4 border-violet-600 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              📋 Morning Briefing — {today}
            </h2>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600 transition p-1"
            title="Dismiss for today"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-500">
          <Loader size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="p-4">
          <div className={`${expanded ? '' : 'max-h-48 overflow-hidden'}`}>
            <div className="space-y-2 text-sm text-gray-700">
              {lines.slice(0, expanded ? undefined : 6).map((line, idx) => {
                const emojiMatch = line.match(/^([^\s]+)\s+(.+)$/);
                if (emojiMatch) {
                  return (
                    <div key={idx} className="flex gap-2">
                      <span className="text-lg flex-shrink-0">{emojiMatch[1]}</span>
                      <span className="flex-1">{emojiMatch[2]}</span>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="ml-6">
                    {line}
                  </div>
                );
              })}
            </div>
          </div>

          {lines.length > 6 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-sm text-violet-600 hover:text-violet-700 font-medium mt-2"
            >
              Show more ({lines.length - 6} items)
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded">
            🤖 AI
          </span>
          <span className="text-xs text-gray-500">
            Generated at {formatTime(briefing.generated_at)}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium"
        >
          <ChevronDown size={14} />
          Reasoning
        </button>
      </div>
    </div>
  );
}
