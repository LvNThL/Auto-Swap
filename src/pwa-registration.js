import { registerSW } from 'virtual:pwa-register'

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const UPDATE_CHECK_THROTTLE_MS = 60 * 1000
let updateAvailable = false
let serviceWorkerRegistration
let lastUpdateCheckAt = 0

function checkForUpdates() {
  if (!serviceWorkerRegistration || !navigator.onLine || document.visibilityState === 'hidden') return

  const now = Date.now()
  if (now - lastUpdateCheckAt < UPDATE_CHECK_THROTTLE_MS) return
  lastUpdateCheckAt = now
  serviceWorkerRegistration.update().catch(() => {})
}

export function hasUpdateAvailable() {
  return updateAvailable
}

export const updateServiceWorker = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    serviceWorkerRegistration = registration
    window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', checkForUpdates)
    window.addEventListener('focus', checkForUpdates)
    window.addEventListener('online', checkForUpdates)
  },
  onNeedRefresh() {
    updateAvailable = true
    window.dispatchEvent(new Event('autoswap:update-ready'))
  },
})
