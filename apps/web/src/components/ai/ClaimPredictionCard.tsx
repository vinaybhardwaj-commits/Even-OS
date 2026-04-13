'use client';

import { useState, useEffect } from 'react';
import { Loader, ChevronRight } from 'lucide-react';

interface DeductionItem {
  reason: string;
  amount: number;
}

interface ClaimPredictionData {
  id: string;
  encounter_id: string;
  predicted_approval_amount: number;
  approval_percentage: number;
  total_claimed: number;
  deductions: DeductionItem[];
  recommendations: string[];
  confidence: number;
  llm_model: string;
  created_at: string;
}

interface ClaimPredictionCardProps {
  encounterId: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

function formatCurrency(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)}Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)}L`;
  }
  if (amount >= 1000) {
    return `₹${(amount / 1000).toFixed(2)}K`;
  }
  return `₹${amount}`;
}

export function ClaimPredictionCard({ encounterId }: ClaimPredictionCardProps) {
  const [prediction, setPrediction] = useState<ClaimPredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const loadPrediction = async () => {
      setLoading(true);
      try {
        const data = await trpcQuery('evenAI.getClaimPrediction', {
          encounter_id: encounterId,
        });
        setPrediction(data);
      } catch (error) {
        console.error('Failed to load claim prediction:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPrediction();
  }, [encounterId]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 flex items-center justify-center h-32">
        <Loader size={24} className="animate-spin text-violet-600" />
      </div>
    );
  }

  if (!prediction) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <p className="text-sm text-gray-500">No prediction available</p>
      </div>
    );
  }

  const totalDeductions = prediction.deductions.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-50 to-emerald-100 border-l-4 border-emerald-600 p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Claim Prediction</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-600 mb-1">Predicted Approval</p>
            <p className="text-2xl font-bold text-emerald-700">
              {formatCurrency(prediction.predicted_approval_amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Approval Rate</p>
            <div className="flex items-end gap-2">
              <p className="text-2xl font-bold text-emerald-700">
                {Math.round(prediction.approval_percentage)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Confidence Bar */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600 font-medium">Confidence</span>
          <span className="text-xs font-medium text-emerald-600">
            {Math.round(prediction.confidence * 100)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-emerald-600 h-2 rounded-full transition-all"
            style={{ width: `${prediction.confidence * 100}%` }}
          />
        </div>
      </div>

      {/* Deductions (if any) */}
      {prediction.deductions.length > 0 && (
        <div className="px-4 pt-4">
          <p className="text-xs font-medium text-gray-600 mb-2 uppercase">Deductions</p>
          <div className="space-y-2">
            {prediction.deductions.slice(0, 3).map((ded, idx) => (
              <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                <span className="text-xs text-gray-700">{ded.reason}</span>
                <span className="text-xs font-medium text-red-600">
                  -{formatCurrency(ded.amount)}
                </span>
              </div>
            ))}
            {prediction.deductions.length > 3 && (
              <p className="text-xs text-gray-600 text-center pt-1">
                +{prediction.deductions.length - 3} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {prediction.recommendations.length > 0 && (
        <div className="px-4 pt-4">
          <p className="text-xs font-medium text-gray-600 mb-2 uppercase">Recommendations</p>
          <ul className="space-y-1">
            {prediction.recommendations.slice(0, 2).map((rec, idx) => (
              <li key={idx} className="text-xs text-gray-700 flex gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded">
            🤖 {prediction.llm_model}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(prediction.created_at).toLocaleString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <a
          href={`/billing/encounters/${encounterId}`}
          className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium"
        >
          View Billing
          <ChevronRight size={14} />
        </a>
      </div>
    </div>
  );
}
