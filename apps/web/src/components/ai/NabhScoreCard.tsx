'use client';

import { useState, useEffect } from 'react';
import { Loader, ChevronRight } from 'lucide-react';

interface ChapterScore {
  id: string;
  name: string;
  abbreviation: string;
  score: number;
  emoji: string;
}

interface NabhScoreData {
  id: string;
  overall_score: number;
  max_score: number;
  chapter_scores: ChapterScore[];
  last_updated: string;
  top_gap: {
    chapter: string;
    gap: number;
  } | null;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

export function NabhScoreCard() {
  const [score, setScore] = useState<NabhScoreData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadScore = async () => {
      setLoading(true);
      try {
        const data = await trpcQuery('evenAI.getNabhScore');
        setScore(data);
      } catch (error) {
        console.error('Failed to load NABH score:', error);
      } finally {
        setLoading(false);
      }
    };

    loadScore();
  }, []);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 flex items-center justify-center h-48">
        <Loader size={24} className="animate-spin text-violet-600" />
      </div>
    );
  }

  if (!score) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <p className="text-sm text-gray-500">No NABH score available</p>
      </div>
    );
  }

  const percentage = (score.overall_score / score.max_score) * 100;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-50 to-violet-100 border-b border-violet-200 p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">NABH Accreditation Score</h3>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-bold text-violet-600">
              {score.overall_score}
            </div>
            <p className="text-xs text-gray-600">out of {score.max_score}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{Math.round(percentage)}%</p>
            <p className="text-xs text-gray-600">Completion</p>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4 pt-4">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-violet-500 to-violet-600 h-2 rounded-full transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Chapter Scores Grid */}
      <div className="p-4">
        <p className="text-xs font-medium text-gray-600 mb-3 uppercase">Chapter Scores</p>
        <div className="grid grid-cols-4 gap-2">
          {score.chapter_scores.map(chapter => (
            <div
              key={chapter.id}
              className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center hover:bg-gray-100 transition"
            >
              <div className="text-lg mb-1">{chapter.emoji}</div>
              <p className="text-xs font-bold text-gray-900">{chapter.score}</p>
              <p className="text-xs text-gray-600">{chapter.abbreviation}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top Gap Alert */}
      {score.top_gap && (
        <div className="mx-4 mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-xs font-medium text-orange-800 mb-1">Priority Gap</p>
          <p className="text-sm text-orange-900">
            {score.top_gap.chapter}: {score.top_gap.gap} point gap
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Last updated: {new Date(score.last_updated).toLocaleDateString('en-IN')}
        </p>
        <a
          href="/admin/compliance"
          className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium"
        >
          View Details
          <ChevronRight size={14} />
        </a>
      </div>
    </div>
  );
}
