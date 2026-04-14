/**
 * Even OS Service Worker — Push Notifications (CM.6)
 *
 * Handles incoming push events and displays native notifications.
 * Registered by push-notifications.ts on the client side.
 */

/* eslint-disable no-restricted-globals */

// Install: skip waiting to activate immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installed');
  self.skipWaiting();
});

// Activate: claim all clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Activated');
  event.waitUntil(self.clients.claim());
});

// Push: display notification
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = { title: 'Even OS', body: 'New notification', icon: '/icon-192.png', tag: 'default' };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        title: payload.title || 'Even OS',
        body: payload.body || payload.message || 'New notification',
        icon: payload.icon || '/icon-192.png',
        tag: payload.tag || payload.category || 'default',
        ...payload,
      };
    } catch {
      data.body = event.data.text() || 'New notification';
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-72.png',
    tag: data.tag,
    vibrate: [200, 100, 200],
    requireInteraction: data.tag === 'escalation' || data.tag === 'critical_value',
    actions: [],
    data: data,
  };

  // Add action buttons based on category
  if (data.tag === 'escalation' || data.tag === 'critical_value') {
    options.actions = [
      { action: 'acknowledge', title: 'Acknowledge' },
      { action: 'view', title: 'View Patient' },
    ];
  } else if (data.tag === 'new_admit') {
    options.actions = [
      { action: 'view', title: 'View Chart' },
    ];
  } else if (data.tag === 'overdue_task' || data.tag === 'medication_due') {
    options.actions = [
      { action: 'view', title: 'Take Action' },
    ];
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click: open/focus the app
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = '/care/home';

  if (data.patient_id) {
    targetUrl = `/care/patient/${data.patient_id}`;
  } else if (data.url) {
    targetUrl = data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If app is already open, focus it and navigate
      for (const client of clients) {
        if (client.url.includes('/care/') && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Notification close: track dismissals (for feedback loop)
self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  console.log('[SW] Notification dismissed:', data.tag, data.title);
});
