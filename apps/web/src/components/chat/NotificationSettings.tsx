'use client';

/**
 * NotificationSettings — OC.6b (refined)
 *
 * Global notification preferences panel shown in the sidebar.
 * Toggle: push notifications, sound, and per-channel mute overrides.
 */

import { useState, useCallback, useEffect } from 'react';
import { trpcMutate } from '@/lib/chat/poll';

interface NotificationSettingsProps {
  visible: boolean;
  onClose: () => void;
}

function Toggle({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex items-center shrink-0
        w-9 h-5 rounded-full transition-colors duration-200
        ${enabled ? 'bg-blue-500' : 'bg-white/20'}
        ${disabled ? 'opacity-50' : ''}`}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow
          transition-transform duration-200
          ${enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
      />
    </button>
  );
}

export function NotificationSettings({ visible, onClose }: NotificationSettingsProps) {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load current preferences
  useEffect(() => {
    if (!visible) return;
    const input = encodeURIComponent(JSON.stringify({ json: {} }));
    fetch(`/api/trpc/chat.getNotificationPrefs?input=${input}`)
      .then(r => r.json())
      .then((data: any) => {
        const global = data?.result?.data?.json?.global;
        if (global) {
          setPushEnabled(global.push_enabled ?? true);
          setSoundEnabled(global.sound_enabled ?? true);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [visible]);

  const save = useCallback(async (push: boolean, sound: boolean) => {
    setIsSaving(true);
    try {
      await trpcMutate('chat.updateGlobalPrefs', {
        push_enabled: push,
        sound_enabled: sound,
      });
    } catch (err) {
      console.error('[NotifSettings] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const togglePush = useCallback(() => {
    const newVal = !pushEnabled;
    setPushEnabled(newVal);
    save(newVal, soundEnabled);
  }, [pushEnabled, soundEnabled, save]);

  const toggleSound = useCallback(() => {
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    save(pushEnabled, newVal);
  }, [pushEnabled, soundEnabled, save]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 bg-[#0A1628] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
        <span className="text-sm font-semibold text-white">Notification Settings</span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {!loaded ? (
        <div className="flex-1 flex items-center justify-center text-white/30 text-xs">Loading...</div>
      ) : (
        <div className="flex-1 overflow-y-auto py-4 px-4 space-y-5">
          {/* Global section */}
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-3">
              Global Preferences
            </h3>

            {/* Push toggle */}
            <div className="flex items-center gap-3 py-2.5">
              <Toggle enabled={pushEnabled} onToggle={togglePush} disabled={isSaving} />
              <div className="min-w-0">
                <div className="text-[13px] text-white leading-tight">Push Notifications</div>
                <div className="text-[10px] text-white/40 mt-0.5">Browser alerts for new messages</div>
              </div>
            </div>

            {/* Sound toggle */}
            <div className="flex items-center gap-3 py-2.5">
              <Toggle enabled={soundEnabled} onToggle={toggleSound} disabled={isSaving} />
              <div className="min-w-0">
                <div className="text-[13px] text-white leading-tight">Sound</div>
                <div className="text-[10px] text-white/40 mt-0.5">Play sound for incoming messages</div>
              </div>
            </div>
          </div>

          {/* Muting hint */}
          <div className="border-t border-white/10 pt-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">
              Per-Channel Muting
            </h3>
            <p className="text-[11px] text-white/30 leading-relaxed">
              To mute a specific channel, open it and click the bell icon
              in the header. Options: 1h, 8h, 24h, 7 days, or indefinite.
            </p>
          </div>

          {/* Keyboard shortcuts reference */}
          <div className="border-t border-white/10 pt-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-white/50">
                <span>Toggle chat sidebar</span>
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Ctrl+Shift+M</kbd>
              </div>
              <div className="flex items-center justify-between text-white/50">
                <span>New direct message</span>
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Ctrl+Shift+N</kbd>
              </div>
              <div className="flex items-center justify-between text-white/50">
                <span>Close chat</span>
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Escape</kbd>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
