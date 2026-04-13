'use client';

import { useState, useEffect } from 'react';
import { Brain, ChevronLeft, Loader } from 'lucide-react';
import { InsightCard } from './InsightCard';

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

interface AISidebarProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}

type FilterType = 'all' | 'clinical' | 'billing' | 'quality' | 'operations' | 'pharmacy';

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

export function AISidebar({ isOpen, onToggle }: AISidebarProps) {
  const [cards, setCards] = useState<InsightCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [cardCount, setCardCount] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  // Count HIGH and CRITICAL severity active cards
  const criticalCount = cards.filter(c => c.severity === 'high' || c.severity === 'critical').length;

  // Filter cards for display
  const filteredCards = filter === 'all'
    ? cards
    : cards.filter(c => c.module.toLowerCase() === filter);

  useEffect(() => {
    if (!isOpen) return;

    const loadCards = async () => {
      setLoading(true);
      try {
        const data = await trpcQuery('evenAI.getInsightCards', { filter });
        setCards(data || []);
        setCardCount(data?.length || 0);
      } catch (error) {
        console.error('Failed to load insight cards:', error);
        setCards([]);
      } finally {
        setLoading(false);
      }
    };

    loadCards();

    const interval = setInterval(loadCards, 30000);
    return () => clearInterval(interval);
  }, [isOpen, filter]);

  const handleDismiss = async (id: string) => {
    setCards(cards.filter(c => c.id !== id));
    try {
      await trpcMutate('evenAI.dismissCard', { card_id: id });
    } catch (error) {
      console.error('Failed to dismiss card:', error);
    }
  };

  const handleAct = async (id: string) => {
    try {
      await trpcMutate('evenAI.actOnCard', { card_id: id });
      setCards(cards.filter(c => c.id !== id));
    } catch (error) {
      console.error('Failed to act on card:', error);
    }
  };

  const handleFeedback = async (id: string, score: 1 | -1) => {
    try {
      await trpcMutate('evenAI.submitFeedback', { card_id: id, score });
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    }
  };

  const handleMarkAllRead = async () => {
    setDismissing(true);
    try {
      // Dismiss all visible filtered cards
      const cardIds = filteredCards.map(c => c.id);
      await Promise.all(
        cardIds.map(id =>
          trpcMutate('evenAI.dismissCard', { card_id: id }).catch(e =>
            console.error(`Failed to dismiss card ${id}:`, e)
          )
        )
      );
      setCards(cards.filter(c => !cardIds.includes(c.id)));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    } finally {
      setDismissing(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => onToggle(true)}
        className="fixed right-0 top-20 w-12 h-12 bg-violet-600 hover:bg-violet-700 text-white rounded-l-lg flex items-center justify-center transition shadow-lg"
        title="Open Even AI (Cmd+I)"
      >
        <div className="relative">
          <Brain size={20} />
          {cardCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {cardCount > 9 ? '9+' : cardCount}
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={20} className="text-violet-600" />
            <h2 className="font-semibold text-gray-900">Even AI</h2>
            <div className="w-2 h-2 rounded-full bg-emerald-500" title="System healthy" />
          </div>
          <button
            onClick={() => onToggle(false)}
            className="text-gray-400 hover:text-gray-600 transition p-1"
          >
            <ChevronLeft size={20} />
          </button>
        </div>
        {criticalCount > 0 && (
          <div className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-semibold">
            {criticalCount} high/critical {criticalCount === 1 ? 'alert' : 'alerts'}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="border-b border-gray-200 p-3 space-y-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(['all', 'clinical', 'billing', 'quality', 'operations', 'pharmacy'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                filter === f
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {filteredCards.length > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={dismissing}
            className="w-full px-2 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition disabled:opacity-50"
          >
            {dismissing ? 'Marking...' : 'Mark All Read'}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader size={20} className="animate-spin text-violet-600" />
          </div>
        ) : filteredCards.length > 0 ? (
          filteredCards.map(card => (
            <InsightCard
              key={card.id}
              card={card}
              onDismiss={handleDismiss}
              onAct={handleAct}
              onFeedback={handleFeedback}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <p className="text-sm">
              {cards.length > 0
                ? `No ${filter !== 'all' ? filter : 'insights'} yet`
                : 'No insights yet'}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 text-xs text-gray-500 text-center">
        <p>Auto-refresh every 30s • Cmd+I to toggle</p>
      </div>
    </div>
  );
}
