'use client';

/**
 * ChatSearch — OC.2b
 *
 * Search input at the top of the sidebar. Filters channels by name
 * as you type (client-side). Debounced to avoid excessive re-renders.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface ChatSearchProps {
  onSearch: (query: string) => void;
}

export function ChatSearch({ onSearch }: ChatSearchProps) {
  const [value, setValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setValue(q);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onSearch(q.trim()), 150);
    },
    [onSearch],
  );

  const handleClear = useCallback(() => {
    setValue('');
    onSearch('');
  }, [onSearch]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="relative px-2 mb-2">
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="Search channels..."
          className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md
            bg-white/8 border border-white/10
            text-white placeholder:text-white/30
            focus:outline-none focus:border-blue-400/50 focus:bg-white/12
            transition-colors"
        />
        {value && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              className="w-3.5 h-3.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
