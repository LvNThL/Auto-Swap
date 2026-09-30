import { registerSW } from 'virtual:pwa-register'

let updateAvailable = false

export function hasUpdateAvailable() {
  return updateAvailable
}

export const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateAvailable = true
    window.dispatchEvent(new Event('autoswap:update-ready'))
  },
})
