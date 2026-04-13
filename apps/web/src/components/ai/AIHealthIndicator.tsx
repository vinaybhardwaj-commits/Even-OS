'use client';

import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  latency_ms: number;
}

interface AIHealthIndicatorProps {
  onClick: () => void;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

export function AIHealthIndicator({ onClick }: AIHealthIndicatorProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [tooltip, setTooltip] = useState(false);

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const data = await trpcQuery('evenAI.getAIHealth');
        setHealth(data);
      } catch (error) {
        console.error('Failed to load AI health:', error);
        setHealth({ status: 'down', latency_ms: 0 });
      }
    };

    loadHealth();
    const interval = setInterval(loadHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!health) return null;

  const statusDot =
    health.status === 'healthy' ? '🟢' : health.status === 'degraded' ? '🟡' : '🔴';

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setTooltip(true)}
        onMouseLeave={() => setTooltip(false)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition text-sm font-medium text-gray-700"
      >
        <span>{statusDot}</span>
        <span>Even AI</span>
      </button>

      {tooltip && (
        <div className="absolute bottom-full left-0 mb-2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
          {health.latency_ms}ms latency
          <div className="absolute top-full left-2 -mt-1 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}
