import { useEffect, useState } from 'react'
import BrandMark from './BrandMark.jsx'
import AccountTools from './AccountTools.jsx'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  setPersistence,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from '../firebase.js'

const SAVED_USERNAME_KEY = 'autoswap-saved-username'

function getSavedUsername() {
  try {
    return window.localStorage.getItem(SAVED_USERNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function AuthHeader({ user, installPrompt, isInstalled, isIos, onInstallPromptConsumed, onThemeChange, themePreference, activePage, onNavigate }) {
  return (
    <header className="topbar">
      <a className="app-brand" href="./" aria-label="AutoSwap Route Desk home">
        <BrandMark />
        <span className="brand-copy"><strong>AutoSwap</strong><small>Route Desk</small></span>
      </a>
      <AccountTools
        installPrompt={installPrompt}
        isInstalled={isInstalled}
        isIos={isIos}
        activePage={activePage}
        onInstallPromptConsumed={onInstallPromptConsumed}
        onNavigate={onNavigate}
        onThemeChange={onThemeChange}
        themePreference={themePreference}
        user={user}
      />
    </header>
  )
}

export default function Auth({ verificationUser, themePreference, onThemeChange, installPrompt, isInstalled, isIos, onInstallPromptConsumed, activePage, onNavigate, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState(getSavedUsername)
  const [password, setPassword] = useState('')
  const [saveUsername, setSaveUsername] = useState(() => Boolean(getSavedUsername()))
  const [rememberMe, setRememberMe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [verificationReminderOpen, setVerificationReminderOpen] = useState(false)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    if (mode !== 'login') return
    try {
      if (saveUsername && email.trim()) window.localStorage.setItem(SAVED_USERNAME_KEY, email.trim())
      else if (!saveUsername) window.localStorage.removeItem(SAVED_USERNAME_KEY)
    } catch {}
  }, [email, mode, saveUsername])

  useEffect(() => {
    if (!verificationUser) return
    const reminderKey = `autoswap-verification-reminder-${verificationUser.uid}`
    try {
      if (window.sessionStorage.getItem(reminderKey) !== 'shown') {
        window.sessionStorage.setItem(reminderKey, 'shown')
        setVerificationReminderOpen(true)
      }
    } catch {
      setVerificationReminderOpen(true)
    }
  }, [verificationUser?.uid])

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setBusy(true)

    try {
      await setPersistence(auth, mode === 'login' && !rememberMe ? browserSessionPersistence : browserLocalPersistence)
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await sendEmailVerification(credential.user)
        setMessage('Account created. Verify your email to continue.')
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
    } catch (error) {
      const messages = {
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/email-already-in-use': 'An account already uses that email.',
        'auth/weak-password': 'Use a password with at least 12 characters.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
      }
      setMessage(messages[error.code] ?? 'Sign-in failed. Check your details and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    setMessage('')
    try {
      await sendEmailVerification(verificationUser)
      setMessage('Verification email sent. Check your inbox.')
    } catch {
      setMessage("Couldn't send verification email. Try again.")
    }
  }

  async function checkVerification() {
    setMessage('')
    try {
      await verificationUser.reload()
      if (verificationUser.emailVerified) {
        await verificationUser.getIdToken(true)
        window.location.reload()
      } else {
        setMessage('Email not verified yet. Open the link in your inbox.')
      }
    } catch {
      setMessage("Couldn't check verification. Try again.")
    }
  }

  if (verificationUser) {
    return (
      <main className="auth-shell">
        <AuthHeader activePage={activePage} installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIos} onInstallPromptConsumed={onInstallPromptConsumed} onNavigate={onNavigate} onThemeChange={onThemeChange} themePreference={themePreference} user={verificationUser} />
        <div className="auth-content">
          <section className="auth-panel">
            <p className="eyebrow">VERIFY YOUR EMAIL</p>
            <h1>One More Step</h1>
            <p className="muted">Verify {verificationUser.email} to use swap routes.</p>
            <p className="verification-spam-note">If it’s not in your inbox, check your spam or junk folder.</p>
            {message && <p className="form-message" role="status">{message}</p>}
            <div className="form-stack">
              <button className="button button-primary" onClick={checkVerification} type="button">I’ve verified my email</button>
              <button className="button button-quiet" onClick={resendVerification} type="button">Resend verification email</button>
            </div>
          </section>
        </div>
        {verificationReminderOpen && (
          <div className="modal-backdrop verification-reminder-backdrop" role="presentation">
            <section aria-labelledby="verification-reminder-title" aria-modal="true" className="confirm-modal verification-reminder" role="dialog">
              <p className="eyebrow">EMAIL VERIFICATION</p>
              <h2 id="verification-reminder-title">Check Your Spam Folder</h2>
              <p className="muted">Check spam if the email is missing. Resend it from this screen.</p>
              <div className="form-actions"><button autoFocus className="button button-primary" onClick={() => setVerificationReminderOpen(false)} type="button">Got it</button></div>
            </section>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <AuthHeader activePage={activePage} installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIos} onInstallPromptConsumed={onInstallPromptConsumed} onNavigate={onNavigate} onThemeChange={onThemeChange} themePreference={themePreference} />
      <div className="auth-content">
        <section className="auth-panel">
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>{mode === 'login' ? 'Sign In to Continue' : 'Create Your Account'}</h1>
          <p className="muted">Your routes are saved privately to your account.</p>
          <form className="form-stack" onSubmit={submit}>
            <label>
              Email address
              <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 12 : 1}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {mode === 'login' && (
              <>
                <label className="remember-option">
                  <input checked={saveUsername} onChange={(event) => setSaveUsername(event.target.checked)} type="checkbox" />
                  <span>Save username</span>
                </label>
                <label className="remember-option">
                  <input checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />
                  <span>Remember me on this device</span>
                </label>
              </>
            )}
            {message && <p className="form-message" role="status">{message}</p>}
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="auth-switch">
            {mode === 'login' ? 'New to AutoSwap?' : 'Already registered?'}{' '}
            <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage('') }} type="button">
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </section>
        <p className="auth-footnote">Wallet keys stay in your wallet. AutoSwap never asks for a recovery phrase.</p>
      </div>
    </main>
  )
}