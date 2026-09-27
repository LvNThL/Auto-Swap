import { useState } from 'react'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from '../firebase.js'

export default function Auth({ verificationUser }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setBusy(true)

    try {
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await sendEmailVerification(credential.user)
        setMessage('Account created. Check your inbox for an email verification link.')
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
      setMessage(messages[error.code] ?? 'Authentication failed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    setMessage('')
    try {
      await sendEmailVerification(verificationUser)
      setMessage('Verification email sent. Check your inbox and spam folder.')
    } catch {
      setMessage('The verification email could not be sent. Try again later.')
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
        setMessage('Email is not verified yet. Open the link from your inbox first.')
      }
    } catch {
      setMessage('Verification status could not be checked. Try again.')
    }
  }

  if (verificationUser) {
    return (
      <main className="auth-shell">
        <div className="auth-brand"><span className="brand-mark" aria-hidden="true">↔</span><span>AutoSwap <i>route desk</i></span></div>
        <section className="auth-panel">
          <p className="eyebrow">VERIFY YOUR EMAIL</p>
          <h1>One more step.</h1>
          <p className="muted">Open the verification link sent to {verificationUser.email}. Swap routes stay locked until your email is verified.</p>
          {message && <p className="form-message" role="status">{message}</p>}
          <div className="form-stack">
            <button className="button button-primary" onClick={checkVerification} type="button">I verified my email</button>
            <button className="button button-quiet" onClick={resendVerification} type="button">Resend verification email</button>
            <button className="text-button" onClick={() => signOut(auth)} type="button">Sign out</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <div className="auth-brand">
        <span className="brand-mark" aria-hidden="true">↔</span>
        <span>AutoSwap <i>route desk</i></span>
      </div>
      <section className="auth-panel">
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>{mode === 'login' ? 'Sign in to continue.' : 'Create your account.'}</h1>
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
    </main>
  )
}