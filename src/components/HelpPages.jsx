import { useState } from 'react'
import { sendPasswordResetEmail, signOut } from 'firebase/auth'
import { auth } from '../firebase.js'
import AccountTools from './AccountTools.jsx'
import BrandMark from './BrandMark.jsx'

const faqSections = [
  {
    title: 'Swaps',
    entries: [
      ['Can my quote change?', 'Yes. It’s an estimate; the final amount may change before the exchange completes.'],
      ['How do I send funds?', 'AutoSwap creates the exchange but never sends funds. Send the exact asset and amount to the displayed network address. Include any required memo or tag.'],
      ['Does AutoSwap connect to my wallet?', 'No. Send from your wallet or exchange. AutoSwap never asks for your recovery phrase or keys.'],
    ],
  },
  {
    title: 'Deposits and tracking',
    entries: [
      ['What does the 10-minute timer mean?', 'It controls how long the address is shown here. It does not cancel the ChangeNOW exchange. Don’t send to an expired address.'],
      ['What does “Close in AutoSwap” do?', 'It closes tracking here, not the ChangeNOW exchange. Close only if you have not sent funds.'],
      ['Why can’t I close an expired tunnel yet?', 'AutoSwap checks ChangeNOW first. The close option appears only if it still reports “Waiting.”'],
      ['Why can I have only three waiting tunnels?', 'You can have three tunnels waiting for deposits. Deposit to or close an unfunded tunnel before opening another.'],
      ['I sent funds, but the status hasn’t changed. What now?', 'Don’t resend or close the tunnel. Network detection can take time. Keep your transaction ID; status refreshes automatically.'],
    ],
  },
]

export default function HelpPages({ page, activePage, user, themePreference, onThemeChange, installPrompt, isInstalled, isIos, onInstallPromptConsumed, onNavigate }) {
  const [accountMessage, setAccountMessage] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  async function sendPasswordReset() {
    if (!user?.email) return
    setResetBusy(true)
    setAccountMessage('')
    try {
      await sendPasswordResetEmail(auth, user.email)
      setAccountMessage('Reset email sent. Check your spam folder if needed.')
    } catch {
      setAccountMessage("Couldn't send reset email. Try again.")
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="app-brand" href="#/swap" aria-label="AutoSwap Route Desk home" onClick={() => onNavigate?.('swap')}>
          <BrandMark />
          <span className="brand-copy"><strong>AutoSwap</strong><small>Route Desk</small></span>
        </a>
        <AccountTools activePage={activePage} installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIos} onInstallPromptConsumed={onInstallPromptConsumed} onNavigate={onNavigate} onThemeChange={onThemeChange} themePreference={themePreference} user={user} />
      </header>
      <main className="information-page">
        {page === 'faq' ? (
          <>
            <div className="information-heading">
              <h1>FAQ</h1>
            </div>
            <div className="faq-sections">
              {faqSections.map((section) => (
                <section className="faq-section" key={section.title}>
                  <h2>{section.title}</h2>
                  {section.entries.map(([question, answer]) => (
                    <details className="faq-entry" key={question}>
                      <summary>{question}</summary>
                      <p>{answer}</p>
                    </details>
                  ))}
                </section>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="information-heading">
              <p className="eyebrow">PERSONAL SETTINGS</p>
              <h1>Account</h1>
              <p className="muted">Your sign-in and security details.</p>
            </div>
            <section className="account-detail-section">
              <h2>Profile</h2>
              <dl className="account-detail-list">
                <div><dt>Email address</dt><dd>{user?.email || 'Not available'}</dd></div>
                <div><dt>Email status</dt><dd><span className="account-verified">Verified</span></dd></div>
                <div><dt>Member since</dt><dd>{user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : 'Not available'}</dd></div>
              </dl>
            </section>
            <section className="account-detail-section">
              <h2>Security</h2>
              <p className="muted">Request a password reset link for your account email.</p>
              {accountMessage && <p className="account-feedback" role="status">{accountMessage}</p>}
              <button className="button button-quiet" disabled={resetBusy || !user?.email} onClick={sendPasswordReset} type="button">{resetBusy ? 'Sending…' : 'Send password reset email'}</button>
            </section>
            <section className="account-detail-section account-sign-out-section">
              <div><h2>Sign out</h2><p className="muted">End this session on this device.</p></div>
              <button className="button button-quiet" onClick={() => signOut(auth)} type="button">Sign out</button>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
