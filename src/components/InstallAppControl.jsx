import { useEffect, useState } from 'react'

export default function InstallAppControl({ installPrompt, isInstalled, isIos, onPromptConsumed, className = '' }) {
  const [showGuide, setShowGuide] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!feedback) return undefined
    const timeout = window.setTimeout(() => setFeedback(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  async function installApp() {
    if (!installPrompt) {
      if (isIos) setShowGuide(true)
      else setFeedback('This browser has not offered app installation. Try Chrome or Edge on Android.')
      return
    }

    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') setFeedback('Installation started')
    } catch {
      setFeedback('The install prompt could not be opened. Try again later.')
    } finally {
      onPromptConsumed()
    }
  }

  if (isInstalled) return null

  return (
    <div className={`install-control ${className}`.trim()}>
      <button aria-label="Install app" className="button button-quiet install-button" onClick={installApp} title="Install app" type="button">
        <span aria-hidden="true">↓</span> Install app
      </button>
      {feedback && <div className="copy-toast install-feedback" role="status" aria-live="polite">{feedback}</div>}
      {showGuide && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowGuide(false) }} role="presentation">
          <section className="confirm-modal install-guide" aria-labelledby="install-guide-title" aria-modal="true" role="dialog">
            <p className="eyebrow">INSTALL AUTOSWAP</p>
            <h2 id="install-guide-title">Add to Home Screen</h2>
            <p className="muted">On iPhone or iPad, Safari requires adding web apps from its Share menu:</p>
            <ol>
              <li>Open this page in Safari.</li>
              <li>Tap the Share button.</li>
              <li>Choose <strong>Add to Home Screen</strong>, then tap Add.</li>
            </ol>
            <div className="form-actions"><button className="button button-primary" onClick={() => setShowGuide(false)} type="button">Got it</button></div>
          </section>
        </div>
      )}
    </div>
  )
}