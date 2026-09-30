import { useEffect, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase.js'
import InstallAppControl from './InstallAppControl.jsx'
import ThemeSelector from './ThemeSelector.jsx'

export default function AccountTools({
  user,
  themePreference,
  onThemeChange,
  installPrompt,
  isInstalled,
  isIos,
  onInstallPromptConsumed,
  activePage = 'swap',
  onNavigate,
  className = '',
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined

    function closeOnPointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }

    function closeOnEscape(event) {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      buttonRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  return (
    <div className={`account-menu ${className}`.trim()}>
      <div className="account-tools">
        <div className="settings-menu" ref={menuRef}>
          <button
            aria-controls="account-settings-panel"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close settings menu' : 'Open settings menu'}
            className="settings-menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            ref={buttonRef}
            title="Settings and account"
            type="button"
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
              <path d="M4 6h12M4 10h12M4 14h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
          {menuOpen && (
            <nav className="settings-menu-panel" id="account-settings-panel" aria-label="Application menu">
              <div className="settings-nav-links">
                <a aria-current={activePage === 'swap' ? 'page' : undefined} href="#/swap" onClick={() => { setMenuOpen(false); onNavigate?.('swap') }}>{user?.emailVerified ? 'Swap' : 'Sign in'}</a>
                {!user && <a aria-current={activePage === 'signup' ? 'page' : undefined} href="#/signup" onClick={() => { setMenuOpen(false); onNavigate?.('signup') }}>Create account</a>}
                <a aria-current={activePage === 'faq' ? 'page' : undefined} href="#/faq" onClick={() => { setMenuOpen(false); onNavigate?.('faq') }}>FAQ</a>
                {user?.emailVerified && <a aria-current={activePage === 'account' ? 'page' : undefined} href="#/account" onClick={() => { setMenuOpen(false); onNavigate?.('account') }}>Account</a>}
              </div>
              <div className="settings-theme-row">
                <span>Theme</span>
                <ThemeSelector className="settings-theme" onChange={(theme) => { onThemeChange(theme); setMenuOpen(false) }} value={themePreference} />
              </div>
              {user && (
                <div className="settings-account-row">
                  <span className="settings-account-email" title={user.email}>{user.email || 'Signed in'}</span>
                  <button className="button button-quiet settings-sign-out" onClick={() => { setMenuOpen(false); signOut(auth) }} type="button">Sign out</button>
                </div>
              )}
            </nav>
          )}
        </div>
        <InstallAppControl installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIos} onPromptConsumed={onInstallPromptConsumed} />
      </div>
    </div>
  )
}