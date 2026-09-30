import { useState } from 'react'
import { sendPasswordResetEmail, signOut } from 'firebase/auth'
import { auth } from '../firebase.js'
import AccountTools from './AccountTools.jsx'
import BrandMark from './BrandMark.jsx'

const faqSections = [
  {
    title: 'Creating a swap',
    entries: [
      ['Are quotes final?', 'No. A quote is an estimate for the selected pair, networks, amount, and destination. Rates and the amount received can change before the exchange finishes. Review the live quote before creating a deposit tunnel.'],
      ['How do I send a deposit?', 'Send only the specified asset on the displayed deposit network to the address for that tunnel. Check the currency, network, amount, and any required memo or tag before confirming in your wallet.'],
      ['Does AutoSwap hold my wallet keys?', 'No. AutoSwap does not request or store wallet recovery phrases or private keys. Sending funds requires a separate approval in your wallet.'],
    ],
  },
  {
    title: 'Deposit tunnels and status',
    entries: [
      ['What happens when the address timer ends?', 'The address is removed from the active deposit details after seven minutes. Do not send funds to an address after its timer ends. The timer only controls how long the address is shown in AutoSwap; it does not deactivate the exchange with the provider.'],
      ['What does “Cancel in Auto Swap” do?', 'It closes local tracking for a tunnel that the provider still reports as waiting for a deposit. It does not cancel the provider exchange or deactivate its deposit address. Only close a tunnel if you have not sent funds.'],
      ['Why am I asked to cancel an expired tunnel?', 'AutoSwap checks the provider after the address timer ends. If the provider still reports “Waiting,” you must close that tunnel in AutoSwap before it leaves your open tunnels list. If a deposit has been detected, the swap continues to appear in activity instead.'],
      ['Why can I only have three waiting tunnels?', 'AutoSwap allows up to three of your locally tracked tunnels to wait for a deposit at one time. Once a deposit is detected or you close a waiting tunnel in AutoSwap, you can open another.'],
      ['What if I sent a deposit but the status has not changed?', 'Allow time for the network and provider to detect it. Keep your wallet transaction details, and do not close a tunnel if you sent funds. AutoSwap refreshes exchange activity periodically.'],
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
      setAccountMessage('Password reset instructions were sent to your email. Check your spam or junk folder if they do not arrive.')
    } catch {
      setAccountMessage('Password reset instructions could not be sent. Please try again later.')
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
              <p className="eyebrow">AUTOSWAP ROUTE DESK</p>
              <h1>Frequently Asked Questions</h1>
              <p className="muted">Clear answers about quotes, deposits, and exchange status.</p>
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
