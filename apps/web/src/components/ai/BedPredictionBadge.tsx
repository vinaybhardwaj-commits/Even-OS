'use client';

import { useState, useEffect } from 'react';
import { Loader } from 'lucide-react';

interface DischargeEstimate {
  time: string;
  confidence: number;
}

interface BedPredictionBadgeProps {
  bedId: string;
  encounterId: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'border-emerald-600 bg-emerald-50';
  if (confidence >= 0.5) return 'border-yellow-600 bg-yellow-50';
  return 'border-red-600 bg-red-50';
}

function getConfidenceBg(confidence: number): string {
  if (confidence >= 0.8) return 'bg-emerald-600';
  if (confidence >= 0.5) return 'bg-yellow-600';
  return 'bg-red-600';
}

export function BedPredictionBadge({ bedId, encounterId }: BedPredictionBadgeProps) {
  const [estimate, setEstimate] = useState<DischargeEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadPrediction = async () => {
      setLoading(true);
      try {
        const data = await trpcQuery('evenAI.getBedPrediction', {
          bed_id: bedId,
          encounter_id: encounterId,
        });
        setEstimate(data);
        setError(false);
      } catch (err) {
        console.error('Failed to load bed prediction:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadPrediction();
  }, [bedId, encounterId]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-1 px-2 py-1">
        <Loader size={12} className="animate-spin text-violet-600" />
        <span className="text-xs text-gray-600">Loading...</span>
      </div>
    );
  }

  if (error || !estimate) {
    return null;
  }

  const confColor = getConfidenceColor(estimate.confidence);
  const confBg = getConfidenceBg(estimate.confidence);

  return (
    <div className={`inline-flex flex-col items-start gap-1 px-2 py-1 border rounded ${confColor}`}>
      <div className="text-xs font-medium text-gray-800">Est. discharge: {estimate.time}</div>
      <div className="w-full bg-gray-200 rounded-full h-1">
        <div
          className={`${confBg} h-1 rounded-full`}
          style={{ width: `${estimate.confidence * 100}%` }}
        />
      </div>
      <div className="text-xs text-gray-600">{Math.round(estimate.confidence * 100)}% confident</div>
    </div>
  );
}
