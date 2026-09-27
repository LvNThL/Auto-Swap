import { lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import Auth from './components/Auth.jsx'
import { auth, isFirebaseConfigured } from './firebase.js'

const SwapEngine = lazy(() => import('./components/SwapEngine.jsx'))

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthReady(true)
    })
  }, [])

  if (!isFirebaseConfigured) {
    return <main className="auth-shell"><div className="auth-brand"><span className="brand-mark">↔</span><span>AutoSwap <i>route desk</i></span></div><section className="auth-panel"><p className="eyebrow">SETUP REQUIRED</p><h1>Connect Firebase.</h1><p className="muted">Set the VITE_FIREBASE_* values in your deployment environment to enable authentication and private route storage.</p></section></main>
  }

  if (!authReady) return <main className="loading-screen">Loading secure workspace…</main>
  if (user && !user.emailVerified) return <Auth verificationUser={user} />
  return user
    ? <Suspense fallback={<main className="loading-screen">Loading secure workspace…</main>}><SwapEngine user={user} /></Suspense>
    : <Auth />
}