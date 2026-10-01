import { useEffect, useState } from 'react'
import { hasUpdateAvailable, updateServiceWorker } from '../pwa-registration.js'

export default function PwaUpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(hasUpdateAvailable)

  useEffect(() => {
    function showUpdatePrompt() {
      setUpdateAvailable(true)
    }
    window.addEventListener('autoswap:update-ready', showUpdatePrompt)
    return () => window.removeEventListener('autoswap:update-ready', showUpdatePrompt)
  }, [])

  if (!updateAvailable) return null

  return (
    <div className="modal-backdrop update-prompt-backdrop" role="presentation">
      <section aria-labelledby="update-prompt-title" aria-modal="true" className="confirm-modal update-prompt" role="dialog">
        <p className="eyebrow">APP UPDATE</p>
        <h2 id="update-prompt-title">An Update Is Ready</h2>
        <p className="muted">A newer version of AutoSwap is available. Update now to load the latest updates.</p>
        <div className="form-actions">
          <button className="button button-quiet" onClick={() => setUpdateAvailable(false)} type="button">Later</button>
          <button autoFocus className="button button-primary" onClick={() => updateServiceWorker(true)} type="button">Update now</button>
        </div>
      </section>
    </div>
  )
}
