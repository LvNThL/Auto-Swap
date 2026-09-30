import { lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import Auth from './components/Auth.jsx'
import HelpPages from './components/HelpPages.jsx'
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

function pageFromHash() {
  const page = window.location.hash.replace(/^#\/?/, '')
  return ['faq', 'account', 'signup'].includes(page) ? page : 'swap'
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [themePreference, setThemePreference] = useState(getSavedTheme)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [activePage, setActivePage] = useState(pageFromHash)

  function navigateTo(page) {
    const nextHash = page === 'swap' ? '#/swap' : `#/${page}`
    if (window.location.hash === nextHash) setActivePage(page)
    else window.location.hash = nextHash
  }

  useEffect(() => {
    function syncPage() {
      setActivePage(pageFromHash())
    }
    window.addEventListener('hashchange', syncPage)
    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  useEffect(() => {
    const pageTitle = activePage === 'faq' ? 'FAQ' : activePage === 'account' ? 'Account' : 'Swap'
    document.title = `${pageTitle} | AutoSwap Route Desk`
  }, [activePage])

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
    return <main className="auth-shell"><div className="auth-toolbar"><ThemeSelector onChange={setThemePreference} value={themePreference} /></div><section className="auth-panel"><p className="eyebrow">SETUP REQUIRED</p><h1>Connect Firebase</h1><p className="muted">Set the VITE_FIREBASE_* values in your deployment environment to enable authentication and private route storage.</p></section></main>
  }

  if (!authReady) return <main className="loading-screen">Loading secure workspace…</main>
  const sharedPageProps = {
    activePage,
    installPrompt,
    isInstalled,
    isIos: isIosDevice(),
    onInstallPromptConsumed: () => setInstallPrompt(null),
    onNavigate: navigateTo,
    onThemeChange: setThemePreference,
    themePreference,
    user,
  }

  if (activePage === 'faq') return <HelpPages {...sharedPageProps} page="faq" />
  if (user && user.emailVerified && activePage === 'account') return <HelpPages {...sharedPageProps} page="account" />
  if (user && !user.emailVerified) return <Auth {...sharedPageProps} verificationUser={user} />
  return user
    ? <Suspense fallback={<main className="loading-screen">Loading secure workspace…</main>}><SwapEngine {...sharedPageProps} key={user.uid} /></Suspense>
    : <Auth {...sharedPageProps} initialMode={activePage === 'signup' ? 'register' : 'login'} />
}