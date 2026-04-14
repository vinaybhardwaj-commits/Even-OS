/**
 * Push Notifications — CM.6
 *
 * Service worker registration, VAPID subscription management,
 * and notification routing logic.
 *
 * Categories:
 * - PUSH (urgent): escalations, critical values, overdue tasks, new admits
 * - IN-APP only: step completions, routine updates, shift handoffs
 *
 * User preferences stored in journey_notifications_preferences (new concept,
 * stored as JSON in user profile or a dedicated table).
 */

// ── Notification categories ─────────────────────────────────────────────────
export interface NotificationCategory {
  key: string;
  label: string;
  description: string;
  defaultPush: boolean;
  defaultInApp: boolean;
  icon: string;
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  { key: 'escalation', label: 'Escalations', description: 'NEWS2 score alerts, clinical escalations', defaultPush: true, defaultInApp: true, icon: '🚨' },
  { key: 'critical_value', label: 'Critical Values', description: 'Abnormal lab results requiring immediate attention', defaultPush: true, defaultInApp: true, icon: '⚠️' },
  { key: 'new_admit', label: 'New Admissions', description: 'Patient assigned to your care or ward', defaultPush: true, defaultInApp: true, icon: '🆕' },
  { key: 'overdue_task', label: 'Overdue Tasks', description: 'Journey steps past their TAT deadline', defaultPush: true, defaultInApp: true, icon: '⏰' },
  { key: 'medication_due', label: 'Medication Due', description: 'Medications approaching or past administration time', defaultPush: true, defaultInApp: true, icon: '💊' },
  { key: 'discharge_ready', label: 'Discharge Ready', description: 'Patient discharge steps waiting for your action', defaultPush: false, defaultInApp: true, icon: '🏥' },
  { key: 'step_complete', label: 'Step Completions', description: 'Journey step completed by another team member', defaultPush: false, defaultInApp: true, icon: '✅' },
  { key: 'shift_handoff', label: 'Shift Handoffs', description: 'Shift change notifications and SBAR briefs', defaultPush: false, defaultInApp: true, icon: '🔄' },
  { key: 'chat_message', label: 'Chat Messages', description: 'Direct messages and mentions in channels', defaultPush: false, defaultInApp: true, icon: '💬' },
  { key: 'routine_update', label: 'Routine Updates', description: 'Non-urgent status updates and summaries', defaultPush: false, defaultInApp: true, icon: '📋' },
];

export interface UserNotificationPreferences {
  categories: Record<string, { push: boolean; inApp: boolean }>;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string;   // "06:00"
  soundEnabled: boolean;
}

export function getDefaultPreferences(): UserNotificationPreferences {
  const categories: Record<string, { push: boolean; inApp: boolean }> = {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    categories[cat.key] = { push: cat.defaultPush, inApp: cat.defaultInApp };
  }
  return {
    categories,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '06:00',
    soundEnabled: true,
  };
}

// ── Notification routing ────────────────────────────────────────────────────

export function shouldSendPush(
  category: string,
  prefs: UserNotificationPreferences
): boolean {
  const catPref = prefs.categories[category];
  if (!catPref) return false;
  if (!catPref.push) return false;

  // Check quiet hours
  if (prefs.quietHoursEnabled) {
    const now = new Date();
    const hours = now.getHours();
    const mins = now.getMinutes();
    const currentTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const { quietHoursStart, quietHoursEnd } = prefs;

    // Handle overnight quiet hours (e.g., 22:00 → 06:00)
    if (quietHoursStart > quietHoursEnd) {
      if (currentTime >= quietHoursStart || currentTime < quietHoursEnd) return false;
    } else {
      if (currentTime >= quietHoursStart && currentTime < quietHoursEnd) return false;
    }
  }

  return true;
}

export function shouldShowInApp(
  category: string,
  prefs: UserNotificationPreferences
): boolean {
  const catPref = prefs.categories[category];
  return catPref?.inApp ?? true;
}

// ── Map journey events to notification categories ───────────────────────────

export function categorizeJourneyEvent(stepNumber: string, eventType: string): string {
  // Escalation-type events
  if (eventType === 'escalation' || eventType === 'news2_alert') return 'escalation';
  if (eventType === 'critical_value') return 'critical_value';
  if (eventType === 'overdue') return 'overdue_task';
  if (eventType === 'medication_due' || eventType === 'med_overdue') return 'medication_due';

  // Admission events
  if (stepNumber.startsWith('2.') || stepNumber === '3.1' || stepNumber === '3.2') return 'new_admit';

  // Discharge events
  if (stepNumber.startsWith('8.') || stepNumber.startsWith('9.')) return 'discharge_ready';

  // Shift events
  if (eventType === 'shift_handoff' || eventType === 'shift_change') return 'shift_handoff';

  // Chat
  if (eventType === 'chat' || eventType === 'direct_message' || eventType === 'mention') return 'chat_message';

  // Default: step completion
  if (eventType === 'step_complete' || eventType === 'journey_step') return 'step_complete';

  return 'routine_update';
}

// ── Service Worker registration ─────────────────────────────────────────────

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    console.log('[Push] Service worker registered:', registration.scope);
    return registration;
  } catch (err) {
    console.error('[Push] Service worker registration failed:', err);
    return null;
  }
}

export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string
): Promise<PushSubscription | null> {
  try {
    // Convert VAPID key to Uint8Array
    const key = urlBase64ToUint8Array(vapidPublicKey);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as unknown as BufferSource,
    });
    console.log('[Push] Subscribed:', subscription.endpoint);
    return subscription;
  } catch (err) {
    console.error('[Push] Subscription failed:', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function unsubscribeFromPush(
  registration: ServiceWorkerRegistration
): Promise<boolean> {
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
