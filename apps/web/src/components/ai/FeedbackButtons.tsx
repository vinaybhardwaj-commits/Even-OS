'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

interface FeedbackButtonsProps {
  cardId: string;
  currentScore: 1 | -1 | null;
  onFeedback: (cardId: string, score: 1 | -1) => void;
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

export function FeedbackButtons({
  cardId,
  currentScore,
  onFeedback,
}: FeedbackButtonsProps) {
  const [loading, setLoading] = useState(false);

  const handleFeedback = async (score: 1 | -1) => {
    setLoading(true);
    try {
      await trpcMutate('evenAI.submitFeedback', {
        card_id: cardId,
        score,
      });
      onFeedback(cardId, score);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => handleFeedback(1)}
        disabled={loading}
        className={`flex items-center gap-1 px-2 py-1 rounded text-sm transition ${
          currentScore === 1
            ? 'bg-emerald-100 text-emerald-700'
            : 'text-gray-600 hover:bg-gray-200'
        } disabled:opacity-50`}
        title="Helpful"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        onClick={() => handleFeedback(-1)}
        disabled={loading}
        className={`flex items-center gap-1 px-2 py-1 rounded text-sm transition ${
          currentScore === -1 ? 'bg-red-100 text-red-700' : 'text-gray-600 hover:bg-gray-200'
        } disabled:opacity-50`}
        title="Not helpful"
      >
        <ThumbsDown size={14} />
      </button>
    </div>
  );
}
