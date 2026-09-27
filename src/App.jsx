import { lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import Auth from './components/Auth.jsx'
import BrandMark from './components/BrandMark.jsx'
import InstallAppControl from './components/InstallAppControl.jsx'
import ThemeSelector from './components/ThemeSelector.jsx'
import { auth, isFirebaseConfigured } from './firebase.js'

const SwapEngine = lazy(() => import('./components/SwapEngine.jsx'))
const supportedThemes = new Set(['system', 'light', 'dark', 'neon', 'azure-trade', 'sage-clay', 'slate-pro', 'twilight-modern'])

function getSavedTheme() {
  try {
    const savedTheme = window.localStorage.getItem('autoswap-theme')
    return supportedThemes.has(savedTheme) ? savedTheme : 'system'
  } catch {
    return 'system'
  }
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [themePreference, setThemePreference] = useState(getSavedTheme)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)')
    setIsInstalled(standalone.matches || window.navigator.standalone === true)

    function captureInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    function markInstalled() {
      setIsInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', markInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', markInstalled)
    }
  }, [])

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
    return <main className="auth-shell"><div className="auth-toolbar"><InstallAppControl installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIosDevice()} onPromptConsumed={() => setInstallPrompt(null)} /><ThemeSelector onChange={setThemePreference} value={themePreference} /></div><div className="auth-brand"><BrandMark /><span className="brand-copy"><strong>AutoSwap</strong><small>Route Desk</small></span></div><section className="auth-panel"><p className="eyebrow">SETUP REQUIRED</p><h1>Connect Firebase</h1><p className="muted">Set the VITE_FIREBASE_* values in your deployment environment to enable authentication and private route storage.</p></section></main>
  }

  if (!authReady) return <main className="loading-screen">Loading secure workspace…</main>
  if (user && !user.emailVerified) return <Auth installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIosDevice()} onInstallPromptConsumed={() => setInstallPrompt(null)} onThemeChange={setThemePreference} themePreference={themePreference} verificationUser={user} />
  return user
    ? <Suspense fallback={<main className="loading-screen">Loading secure workspace…</main>}><SwapEngine installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIosDevice()} key={user.uid} onInstallPromptConsumed={() => setInstallPrompt(null)} onThemeChange={setThemePreference} themePreference={themePreference} user={user} /></Suspense>
    : <Auth installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIosDevice()} onInstallPromptConsumed={() => setInstallPrompt(null)} onThemeChange={setThemePreference} themePreference={themePreference} />
}