'use client';

import { useState, useEffect } from 'react';
import {
  NOTIFICATION_CATEGORIES,
  getDefaultPreferences,
  registerServiceWorker,
  type UserNotificationPreferences,
} from '@/lib/push-notifications';

interface Props {
  userId: string;
  onClose?: () => void;
}

/**
 * NotificationSettings — user preference panel for push and in-app notifications.
 * Displayed in profile/settings or as a modal from the chat panel.
 */
export default function NotificationSettings({ userId, onClose }: Props) {
  const [prefs, setPrefs] = useState<UserNotificationPreferences>(getDefaultPreferences());
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Check push support
    if (typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }

    // Load saved preferences from localStorage (fallback until DB-backed)
    try {
      const stored = localStorage.getItem(`even_notif_prefs_${userId}`);
      if (stored) setPrefs(JSON.parse(stored));
    } catch { /* use defaults */ }
  }, [userId]);

  const updateCategory = (key: string, field: 'push' | 'inApp', value: boolean) => {
    setPrefs(prev => ({
      ...prev,
      categories: {
        ...prev.categories,
        [key]: { ...prev.categories[key], [field]: value },
      },
    }));
  };

  const requestPushPermission = async () => {
    if (!pushSupported) return;
    const permission = await Notification.requestPermission();
    setPushPermission(permission);
    if (permission === 'granted') {
      await registerServiceWorker();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to localStorage (immediate) + could POST to API for persistence
      localStorage.setItem(`even_notif_prefs_${userId}`, JSON.stringify(prefs));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: '#fff', borderRadius: 12, border: '1px solid #e0e0e0',
      maxWidth: 500, margin: '0 auto', fontFamily: 'system-ui',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid #e0e0e0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>🔔 Notification Preferences</h2>
        {onClose && (
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888',
          }}>✕</button>
        )}
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* Push permission */}
        {pushSupported && pushPermission !== 'granted' && (
          <div style={{
            background: '#e3f2fd', borderRadius: 8, padding: '12px 16px',
            border: '1px solid #90caf9', marginBottom: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1565c0' }}>Enable Push Notifications</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Get alerts even when Even OS is not open</div>
            </div>
            <button onClick={requestPushPermission} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 700,
              background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            }}>
              Enable
            </button>
          </div>
        )}

        {pushPermission === 'granted' && (
          <div style={{
            background: '#e8f5e9', borderRadius: 8, padding: '8px 16px',
            border: '1px solid #a5d6a7', marginBottom: 16, fontSize: 12, color: '#2e7d32',
          }}>
            ✅ Push notifications enabled
          </div>
        )}

        {pushPermission === 'denied' && (
          <div style={{
            background: '#ffebee', borderRadius: 8, padding: '8px 16px',
            border: '1px solid #ef9a9a', marginBottom: 16, fontSize: 12, color: '#c62828',
          }}>
            ❌ Push blocked by browser. Enable in browser settings → Site permissions.
          </div>
        )}

        {/* Category toggles */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 50px 50px',
            gap: 0, fontSize: 11, fontWeight: 700, color: '#888',
            padding: '0 0 8px', borderBottom: '1px solid #e0e0e0', marginBottom: 8,
          }}>
            <span>Category</span>
            <span style={{ textAlign: 'center' }}>Push</span>
            <span style={{ textAlign: 'center' }}>In-App</span>
          </div>

          {NOTIFICATION_CATEGORIES.map(cat => {
            const catPref = prefs.categories[cat.key] || { push: cat.defaultPush, inApp: cat.defaultInApp };
            return (
              <div key={cat.key} style={{
                display: 'grid', gridTemplateColumns: '1fr 50px 50px',
                gap: 0, alignItems: 'center', padding: '8px 0',
                borderBottom: '1px solid #f5f5f5',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{cat.icon} {cat.label}</div>
                  <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{cat.description}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={catPref.push}
                    onChange={(e) => updateCategory(cat.key, 'push', e.target.checked)}
                    disabled={pushPermission !== 'granted'}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={catPref.inApp}
                    onChange={(e) => updateCategory(cat.key, 'inApp', e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Quiet Hours */}
        <div style={{
          background: '#fafafa', borderRadius: 8, padding: '12px 16px',
          border: '1px solid #e0e0e0', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🌙 Quiet Hours</div>
              <div style={{ fontSize: 10, color: '#888' }}>Pause push notifications during off hours</div>
            </div>
            <input
              type="checkbox"
              checked={prefs.quietHoursEnabled}
              onChange={(e) => setPrefs(p => ({ ...p, quietHoursEnabled: e.target.checked }))}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
          </div>
          {prefs.quietHoursEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ color: '#666' }}>From</span>
              <input type="time" value={prefs.quietHoursStart}
                onChange={(e) => setPrefs(p => ({ ...p, quietHoursStart: e.target.value }))}
                style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 12 }}
              />
              <span style={{ color: '#666' }}>to</span>
              <input type="time" value={prefs.quietHoursEnd}
                onChange={(e) => setPrefs(p => ({ ...p, quietHoursEnd: e.target.value }))}
                style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 12 }}
              />
            </div>
          )}
        </div>

        {/* Sound */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0', marginBottom: 16,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>🔊 Notification Sound</div>
            <div style={{ fontSize: 10, color: '#888' }}>Play sound for in-app notifications</div>
          </div>
          <input
            type="checkbox"
            checked={prefs.soundEnabled}
            onChange={(e) => setPrefs(p => ({ ...p, soundEnabled: e.target.checked }))}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
        </div>

        {/* Save */}
        <button onClick={handleSave} disabled={saving} style={{
          width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 700,
          background: saved ? '#e8f5e9' : saving ? '#e0e0e0' : '#1565c0',
          color: saved ? '#2e7d32' : '#fff',
          border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
        }}>
          {saved ? '✅ Saved' : saving ? 'Saving…' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
