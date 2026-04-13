'use client';

import { ChevronUp } from 'lucide-react';

interface ReasoningDrawerProps {
  explanation: string;
  dataSources: string[];
  isOpen: boolean;
  onToggle: () => void;
}

export function ReasoningDrawer({
  explanation,
  dataSources,
  isOpen,
  onToggle,
}: ReasoningDrawerProps) {
  return (
    <div
      className={`overflow-hidden transition-all duration-300 ${
        isOpen ? 'max-h-96' : 'max-h-0'
      }`}
    >
      <div className="bg-violet-50 border-t border-violet-200 p-4">
        <button
          onClick={onToggle}
          className="flex items-center justify-between w-full mb-3 text-sm font-medium text-violet-700 hover:text-violet-900"
        >
          <span>Reasoning</span>
          <ChevronUp
            size={16}
            className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <>
            {explanation && (
              <div className="mb-4">
                <p className="text-xs text-gray-600 mb-2 font-medium">Explanation</p>
                <p className="text-sm text-gray-700 leading-relaxed">{explanation}</p>
              </div>
            )}

            {dataSources.length > 0 && (
              <div>
                <p className="text-xs text-gray-600 mb-2 font-medium">Data Sources</p>
                <div className="flex flex-wrap gap-2">
                  {dataSources.map((source, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2 py-1 bg-violet-200 text-violet-800 text-xs rounded"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
