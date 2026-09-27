import { lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import Auth from './components/Auth.jsx'
import ThemeSelector from './components/ThemeSelector.jsx'
import { auth, isFirebaseConfigured } from './firebase.js'

const SwapEngine = lazy(() => import('./components/SwapEngine.jsx'))

function getSavedTheme() {
  try {
    const savedTheme = window.localStorage.getItem('autoswap-theme')
    return ['system', 'light', 'dark'].includes(savedTheme) ? savedTheme : 'system'
  } catch {
    return 'system'
  }
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [themePreference, setThemePreference] = useState(getSavedTheme)

  useEffect(() => {
    const systemPreference = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = themePreference === 'system'
        ? systemPreference.matches ? 'dark' : 'light'
        : themePreference
    }

    applyTheme()
    systemPreference.addEventListener('change', applyTheme)
    try {
      window.localStorage.setItem('autoswap-theme', themePreference)
    } catch {}
    return () => systemPreference.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthReady(true)
    })
  }, [])

  if (!isFirebaseConfigured) {
    return <main className="auth-shell"><ThemeSelector className="auth-theme-selector" onChange={setThemePreference} value={themePreference} /><div className="auth-brand"><span className="brand-mark">↔</span><span className="brand-copy"><strong>AutoSwap</strong><small>Route Desk</small></span></div><section className="auth-panel"><p className="eyebrow">SETUP REQUIRED</p><h1>Connect Firebase.</h1><p className="muted">Set the VITE_FIREBASE_* values in your deployment environment to enable authentication and private route storage.</p></section></main>
  }

  if (!authReady) return <main className="loading-screen">Loading secure workspace…</main>
  if (user && !user.emailVerified) return <Auth onThemeChange={setThemePreference} themePreference={themePreference} verificationUser={user} />
  return user
    ? <Suspense fallback={<main className="loading-screen">Loading secure workspace…</main>}><SwapEngine key={user.uid} onThemeChange={setThemePreference} themePreference={themePreference} user={user} /></Suspense>
    : <Auth onThemeChange={setThemePreference} themePreference={themePreference} />
}