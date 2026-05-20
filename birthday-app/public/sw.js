const CACHE_NAME = 'birthday-reminder-shell-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/app-icon.svg', '/firebase-config.js']

try {
  self.importScripts('/firebase-config.js')
  if (self.FIREBASE_CONFIG?.apiKey) {
    self.importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
    self.importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')
    self.firebase.initializeApp({
      apiKey: self.FIREBASE_CONFIG.apiKey,
      authDomain: self.FIREBASE_CONFIG.authDomain,
      projectId: self.FIREBASE_CONFIG.projectId,
      storageBucket: self.FIREBASE_CONFIG.storageBucket,
      messagingSenderId: self.FIREBASE_CONFIG.messagingSenderId,
      appId: self.FIREBASE_CONFIG.appId,
    })

    const messaging = self.firebase.messaging()
    messaging.onBackgroundMessage((payload) => {
      const title = payload?.notification?.title || 'Birthday Reminder'
      const options = {
        body: payload?.notification?.body || 'You have an upcoming birthday reminder.',
        data: payload?.data || {},
      }
      self.registration.showNotification(title, options)
    })
  }
} catch (error) {
  // Firebase is optional. App shell caching still works without it.
  console.warn('Firebase SW setup skipped:', error)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL)
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy)
          })
          return response
        })
        .catch(() => caches.match('/index.html'))
    }),
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload?.notification?.title || payload?.title || 'Birthday Reminder'
  const body =
    payload?.notification?.body || payload?.body || 'You have an upcoming birthday reminder.'
  const data = payload?.data || {}

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
      return null
    }),
  )
})
