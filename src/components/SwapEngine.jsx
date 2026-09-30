import { useEffect, useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import Select from 'react-select'
import { auth, functions, isFirebaseConfigured } from '../firebase.js'
import AccountTools from './AccountTools.jsx'
import BrandMark from './BrandMark.jsx'
import {
  createAddressBookEntry,
  deleteAddressBookEntry,
  listAddressBookEntries,
} from '../services/AddressBookManager.js'
import { createPreset, deletePreset, listPresets, updatePreset } from '../services/PresetManager.js'

const emptyPreset = {
  fromCurrency: 'btc',
  fromNetwork: 'btc',
  toCurrency: 'eth',
  toNetwork: 'eth',
  fromAmount: '',
  destinationAddress: '',
  destinationExtraId: '',
  refundAddress: '',
  refundExtraId: '',
}

const TUNNEL_ACCESS_TTL_MS = 7 * 60 * 1000
const NEW_PRESET_VIEW = 'new'

function getSavedPresetView(uid) {
  try {
    return window.localStorage.getItem(`autoswap-open-preset-${uid}`) ?? ''
  } catch {
    return ''
  }
}

function savePresetView(uid, view) {
  try {
    if (view) window.localStorage.setItem(`autoswap-open-preset-${uid}`, view)
    else window.localStorage.removeItem(`autoswap-open-preset-${uid}`)
  } catch {}
}

function currencyGroups(currencies, isSearching = false) {
  if (isSearching) return currencies.length ? [{ label: 'Search results', options: currencies }] : []

  const featured = currencies.filter((currency) => currency.featured)
  const other = currencies.filter((currency) => !currency.featured)
  return [
    ...(featured.length ? [{ label: 'Popular', options: featured }] : []),
    ...(other.length ? [{ label: 'More supported assets', options: other }] : []),
  ]
}

function CurrencyLogo({ currency, className }) {
  const ticker = String(currency?.ticker || '?').toUpperCase()

  return (
    <span className={`currency-logo ${className}`} aria-hidden="true">
      <span>{ticker.slice(0, 3)}</span>
      {currency?.image && <img src={currency.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} onLoad={(event) => { event.currentTarget.style.visibility = 'visible' }} />}
    </span>
  )
}

const assetSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 42,
    borderColor: state.isFocused ? 'var(--green)' : 'var(--line)',
    backgroundColor: 'var(--paper)',
    color: 'var(--ink)',
    borderRadius: 5,
    boxShadow: 'none',
    fontSize: 12,
    ':hover': { borderColor: 'var(--muted)' },
  }),
  input: (base) => ({ ...base, color: 'var(--ink)' }),
  placeholder: (base) => ({ ...base, color: 'var(--placeholder)' }),
  singleValue: (base) => ({ ...base, color: 'var(--ink)' }),
  menuPortal: (base) => ({ ...base, zIndex: 30 }),
  menu: (base) => ({ ...base, zIndex: 30, overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 6, backgroundColor: 'var(--paper)' }),
  menuList: (base) => ({ ...base, maxHeight: 260, overflowY: 'auto', scrollbarWidth: 'thin' }),
  groupHeading: (base) => ({ ...base, color: 'var(--muted)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, textTransform: 'uppercase' }),
  option: (base, state) => ({
    ...base,
    padding: '8px 11px',
    backgroundColor: state.isSelected ? 'var(--select-selected)' : state.isFocused ? 'var(--select-focused)' : 'var(--paper)',
    color: 'var(--ink)',
    cursor: 'pointer',
  }),
}

function formatCurrencyOption(currency) {
  return (
    <div className="asset-option-label">
      <span className="asset-option-main">
        <CurrencyLogo currency={currency} className="asset-option-logo" />
        <span>{currency.name}</span>
      </span>
      <small>{currency.ticker.toUpperCase()} · {currency.network.toUpperCase()}</small>
    </div>
  )
}

function findCurrency(currencies, ticker, network) {
  return currencies.find((currency) => currency.ticker === ticker && currency.network === network)
}

function getCurrencyTooltip(currency, ticker, network) {
  const symbol = String(ticker || '').toUpperCase()
  const networkName = String(network || '').toUpperCase()
  const assetName = currency?.name || symbol
  return `${assetName} · ${symbol}${networkName ? ` (${networkName})` : ''}`
}

function formatEstimatedRate(fromAmount, estimatedAmount, fromTicker, toTicker) {
  const sentAmount = Number(fromAmount)
  const receivedAmount = Number(estimatedAmount)
  if (!Number.isFinite(sentAmount) || sentAmount <= 0 || !Number.isFinite(receivedAmount) || receivedAmount <= 0) return null

  const rate = receivedAmount / sentAmount
  if (!Number.isFinite(rate) || rate <= 0) return null

  const formattedRate = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(rate)
  return `1 ${fromTicker.toUpperCase()} ≈ ${formattedRate} ${toTicker.toUpperCase()}`
}

function searchCurrencies(currencies, query) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return currencies

  const matches = currencies.filter((currency) =>
    `${currency.name} ${currency.ticker} ${currency.network}`.toLowerCase().includes(normalizedQuery))

  function matchRank(currency) {
    const name = currency.name.toLowerCase()
    const ticker = currency.ticker.toLowerCase()
    if (name === normalizedQuery || ticker === normalizedQuery) return 0
    if (name.startsWith(normalizedQuery) || ticker.startsWith(normalizedQuery)) return 1
    if (name.includes(normalizedQuery) || ticker.includes(normalizedQuery)) return 2
    return 3
  }

  return matches.sort((left, right) =>
    matchRank(left) - matchRank(right)
      || Number(right.featured) - Number(left.featured)
      || left.name.localeCompare(right.name)
      || left.network.localeCompare(right.network))
}

function getSourceWalletName() {
  return 'Source Wallet'
}

function getDestinationWalletName() {
  return 'Destination Wallet'
}

function getPresetName(preset) {
  const fromCurrency = String(preset.fromCurrency ?? '').toUpperCase()
  const toCurrency = String(preset.toCurrency ?? '').toUpperCase()
  const fromNetwork = String(preset.fromNetwork ?? '').toUpperCase()
  const toNetwork = String(preset.toNetwork ?? '').toUpperCase()
  const fromAsset = fromCurrency && fromNetwork ? `${fromCurrency} (${fromNetwork})` : fromCurrency
  const toAsset = toCurrency && toNetwork ? `${toCurrency} (${toNetwork})` : toCurrency
  return `${fromAsset} to ${toAsset}`
}

function getErrorMessage(error) {
  if (error?.code === 'functions/permission-denied') return 'Sign in again before creating a swap.'
  if (error?.code === 'functions/invalid-argument') return error.message
  return error?.message || 'The route could not be completed. Check the route and try again.'
}

function formatSwapStatus(status, cancellationReason) {
  const normalizedStatus = String(status).toLowerCase()
  if (normalizedStatus === 'cancelled' && cancellationReason === 'user-requested') return 'Closed in AutoSwap'
  if (normalizedStatus === 'cancelled' && cancellationReason === 'access-window-ended') return 'Closed after 7 minutes'
  if (normalizedStatus === 'cancelled' && cancellationReason === 'provider-expired') return 'Expired'
  if (normalizedStatus === 'waiting') return 'Waiting for deposit'
  if (normalizedStatus === 'finished') return 'Completed'
  return String(status || 'unknown').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatTunnelTimeRemaining(expiresAt, now) {
  const totalSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const swapProgressSteps = ['Waiting for deposit', 'Confirming', 'Exchanging', 'Sending', 'Completed']
const swapProgressByStatus = {
  waiting: { step: 0, label: 'Deposit not detected yet', detail: "If you sent it, don't resend; allow time for network confirmation." },
  confirming: { step: 1, label: 'Confirming', detail: 'ChangeNOW has detected the deposit. Network confirmations are in progress.' },
  exchanging: { step: 2, label: 'Exchanging', detail: 'ChangeNOW is processing the exchange.' },
  sending: { step: 3, label: 'Sending', detail: 'ChangeNOW is sending the exchanged asset to your destination.' },
  finished: { step: 4, label: 'Completed', detail: 'ChangeNOW reports this exchange is complete.' },
}

function getSwapProgress(status, cancellationReason) {
  const normalizedStatus = String(status || 'waiting').toLowerCase()
  if (swapProgressByStatus[normalizedStatus]) return swapProgressByStatus[normalizedStatus]

  const detail = normalizedStatus === 'refunded'
    ? 'Check your wallet for the return transfer before creating another swap.'
    : normalizedStatus === 'cancelled'
      ? 'Closing tracking in AutoSwap does not cancel the ChangeNOW exchange or invalidate its deposit address.'
      : 'Check the exchange status and your wallet activity before trying again.'
  return { step: -1, label: formatSwapStatus(normalizedStatus, cancellationReason), detail }
}

const terminalSwapStatuses = new Set(['finished', 'failed', 'refunded', 'expired', 'cancelled'])
const depositReceivedStatuses = new Set(['confirming', 'exchanging', 'sending', 'finished', 'failed', 'refunded'])
const inProgressOrCompletedStatuses = new Set(['waiting', 'confirming', 'exchanging', 'sending', 'finished'])
const MAX_WAITING_TUNNELS = 3
const autoSwapClosureReasons = new Set(['user-requested', 'access-window-ended'])

function isLocallyClosedSwap(swap) {
  return String(swap.status || '').toLowerCase() === 'cancelled'
    && autoSwapClosureReasons.has(swap.cancellationReason)
}

function SwapHistoryItem({ swap }) {
  const status = String(swap.status || 'unknown').toLowerCase()
  const isTerminal = terminalSwapStatuses.has(status)

  return (
    <article className="history-item">
      <div className="history-main">
        <strong>{swap.fromCurrency?.toUpperCase()} <span>to</span> {swap.toCurrency?.toUpperCase()}</strong>
        <small>{swap.fromAmount} {swap.fromCurrency?.toUpperCase()} ({swap.fromNetwork?.toUpperCase()}) → {swap.toCurrency?.toUpperCase()} ({swap.toNetwork?.toUpperCase()})</small>
        <small>{swap.createdAt ? new Date(swap.createdAt).toLocaleString() : 'Date unavailable'}{swap.toAmount ? ` · ${status === 'finished' ? 'Received' : 'Est. receive'} ${swap.toAmount} ${swap.toCurrency?.toUpperCase()}` : ''}</small>
        {swap.exchangeId && <small>Exchange ID: <code>{swap.exchangeId}</code></small>}
        {(swap.payinExplorerUrl || swap.payoutExplorerUrl) && (
          <div className="history-blockchain-links">
            {swap.payinExplorerUrl && <a className="history-blockchain-link" href={swap.payinExplorerUrl} rel="noopener noreferrer" target="_blank">View deposit on blockchain</a>}
            {swap.payoutExplorerUrl && <a className="history-blockchain-link" href={swap.payoutExplorerUrl} rel="noopener noreferrer" target="_blank">View payout on blockchain</a>}
          </div>
        )}
      </div>
      <div className="history-status-controls">
        <span className={`history-status ${isTerminal ? `history-status-${status}` : 'history-status-pending'}`}>{formatSwapStatus(status, swap.cancellationReason)}</span>
      </div>
    </article>
  )
}

export default function SwapEngine({ user, themePreference, onThemeChange, installPrompt, isInstalled, isIos, onInstallPromptConsumed, activePage, onNavigate, startWithNewPreset = false }) {
  const [initialPresetView] = useState(() => getSavedPresetView(user.uid))
  const [presets, setPresets] = useState([])
  const [presetsLoading, setPresetsLoading] = useState(true)
  const [presetsLoadError, setPresetsLoadError] = useState(false)
  const [currencies, setCurrencies] = useState([])
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [currencyError, setCurrencyError] = useState('')
  const [currencyReloadKey, setCurrencyReloadKey] = useState(0)
  const [minimumAmount, setMinimumAmount] = useState('')
  const [minimumStatus, setMinimumStatus] = useState('idle')
  const [addressBookEntries, setAddressBookEntries] = useState([])
  const [addressBookDialog, setAddressBookDialog] = useState('')
  const [addressDraft, setAddressDraft] = useState({ label: '', address: '', extraId: '', ticker: '', network: '', purpose: '' })
  const [addressBookBusy, setAddressBookBusy] = useState(false)
  const [addressBookError, setAddressBookError] = useState('')
  const [fromSearch, setFromSearch] = useState('')
  const [toSearch, setToSearch] = useState('')
  const [selectedId, setSelectedId] = useState(() => initialPresetView === NEW_PRESET_VIEW ? '' : initialPresetView)
  const [form, setForm] = useState(emptyPreset)
  const [swapDestinationExtraId, setSwapDestinationExtraId] = useState('')
  const [swapRefundExtraId, setSwapRefundExtraId] = useState('')
  const [showNewPreset, setShowNewPreset] = useState(() => initialPresetView === NEW_PRESET_VIEW)
  const [routeListScrolling, setRouteListScrolling] = useState(false)
  const routeListScrollTimeout = useRef(null)
  const fromAssetSelectRef = useRef(null)
  const toAssetSelectRef = useRef(null)
  const [editingPresetId, setEditingPresetId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [quote, setQuote] = useState(null)
  const [tunnel, setTunnel] = useState(null)
  const [tunnelPreset, setTunnelPreset] = useState(null)
  const [swapHistory, setSwapHistory] = useState([])
  const [pendingSwaps, setPendingSwaps] = useState([])
  const [historyArchives, setHistoryArchives] = useState([])
  const [historyArchivesLoading, setHistoryArchivesLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [archiveDownloadBusy, setArchiveDownloadBusy] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [historyFilter, setHistoryFilter] = useState('in-progress-completed')
  const [cancellingExchangeId, setCancellingExchangeId] = useState('')
  const [statusCheckByExchange, setStatusCheckByExchange] = useState({})
  const [copyToast, setCopyToast] = useState(null)
  const [clockNow, setClockNow] = useState(() => Date.now())

  useEffect(() => () => window.clearTimeout(routeListScrollTimeout.current), [])

  function handleRouteListScroll() {
    setRouteListScrolling(true)
    window.clearTimeout(routeListScrollTimeout.current)
    routeListScrollTimeout.current = window.setTimeout(() => setRouteListScrolling(false), 700)
  }

  const selectedPreset = presets.find((preset) => preset.id === selectedId)
  const selectedPresetFromCurrency = selectedPreset
    ? findCurrency(currencies, selectedPreset.fromCurrency, selectedPreset.fromNetwork)
    : null
  const selectedPresetToCurrency = selectedPreset
    ? findCurrency(currencies, selectedPreset.toCurrency, selectedPreset.toNetwork)
    : null
  const selectedPresetRefundExtraIdRequired = Boolean(selectedPreset?.refundAddress && selectedPresetFromCurrency?.requiresExtraId)
  const waitingTunnelCount = pendingSwaps.filter((swap) => String(swap.status || 'waiting').toLowerCase() === 'waiting').length
  const openTunnels = pendingSwaps
    .map((swap) => ({
      ...swap,
      id: swap.exchangeId ?? swap.id,
      accessExpiresAt: swap.accessExpiresAt ?? (swap.createdAt ? swap.createdAt + TUNNEL_ACCESS_TTL_MS : 0),
    }))
    .filter((swap) => swap.payinAddress && (
      clockNow < swap.accessExpiresAt
      || String(swap.status || 'waiting').toLowerCase() === 'waiting'
    ))
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  if (tunnel?.payinAddress && (clockNow < tunnel.accessExpiresAt || String(tunnel.status || 'waiting').toLowerCase() === 'waiting') && !openTunnels.some((swap) => swap.id === tunnel.id)) {
    openTunnels.unshift({
      ...tunnel,
      fromCurrency: tunnelPreset?.fromCurrency,
      fromNetwork: tunnelPreset?.fromNetwork,
      fromAmount: tunnelPreset?.fromAmount,
      toCurrency: tunnelPreset?.toCurrency,
      toNetwork: tunnelPreset?.toNetwork,
      createdAt: tunnel.accessExpiresAt - TUNNEL_ACCESS_TTL_MS,
    })
  }
  const openTunnelIds = new Set(openTunnels.map((swap) => swap.id).filter(Boolean))
  const openTunnelTimerKey = openTunnels
    .filter((swap) => clockNow < swap.accessExpiresAt)
    .map((swap) => swap.id)
    .join('|')
  const pendingHistorySwaps = pendingSwaps.map((swap) => ({
    ...swap,
    id: swap.id ?? swap.exchangeId,
    toAmount: swap.estimatedAmount ?? null,
    status: swap.status || 'waiting',
    pending: true,
  }))
  const pendingHistoryIds = new Set(pendingHistorySwaps.flatMap((swap) => [swap.id, swap.exchangeId]).filter(Boolean))
  const locallyOpenHistorySwaps = openTunnels
    .filter((swap) => !pendingHistoryIds.has(swap.id) && !pendingHistoryIds.has(swap.exchangeId))
    .map((swap) => ({
      ...swap,
      toAmount: swap.estimatedAmount ?? null,
      status: swap.status || 'waiting',
      pending: true,
    }))
  const visibleSwapHistory = [
    ...swapHistory.filter((swap) => {
      const status = String(swap.status || '').toLowerCase()
      return depositReceivedStatuses.has(status) || terminalSwapStatuses.has(status)
    }),
    ...pendingHistorySwaps,
    ...locallyOpenHistorySwaps,
  ].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  const filteredSwapHistory = visibleSwapHistory.filter((swap) => {
    if ((swap.id && openTunnelIds.has(swap.id)) || (swap.exchangeId && openTunnelIds.has(swap.exchangeId))) return true
    const status = String(swap.status || '').toLowerCase()
    if (historyFilter === 'in-progress-completed') return inProgressOrCompletedStatuses.has(status)
    if (historyFilter === 'cancelled') return status === 'cancelled' && swap.cancellationReason !== 'provider-expired'
    if (historyFilter === 'expired') return status === 'expired' || swap.cancellationReason === 'provider-expired'
    if (historyFilter === 'failed') return status === 'failed' || status === 'refunded'
    return true
  })
  const recentSwapHistory = filteredSwapHistory.slice(0, 7)
  const olderSwapHistory = filteredSwapHistory.slice(7)
  const fromCurrencies = currencies.filter((currency) => currency.canSell)
  const toCurrencies = currencies.filter((currency) => currency.canBuy)
  const fromSearchLower = fromSearch.trim().toLowerCase()
  const toSearchLower = toSearch.trim().toLowerCase()
  const matchingFromCurrencies = searchCurrencies(fromCurrencies, fromSearchLower)
  const matchingToCurrencies = searchCurrencies(toCurrencies, toSearchLower)
  const selectedFromCurrency = currencies.find((currency) =>
    currency.ticker === form.fromCurrency && currency.network === form.fromNetwork)
  const selectedToCurrency = currencies.find((currency) =>
    currency.ticker === form.toCurrency && currency.network === form.toNetwork)
  const formDestinationWalletName = getDestinationWalletName(form)
  const estimatedRate = quote && selectedPreset
    ? formatEstimatedRate(selectedPreset.fromAmount, quote.estimatedAmount, selectedPreset.fromCurrency, selectedPreset.toCurrency)
    : null
  const quoteExpired = Boolean(confirming && quote?.quoteExpiresAt && clockNow >= quote.quoteExpiresAt)
  const destinationAddressEntries = addressBookEntries.filter((entry) =>
    entry.purpose === 'destination' && entry.ticker === selectedToCurrency?.ticker && entry.network === selectedToCurrency?.network)
  const refundAddressEntries = addressBookEntries.filter((entry) =>
    entry.purpose === 'refund' && entry.ticker === selectedFromCurrency?.ticker && entry.network === selectedFromCurrency?.network)
  const managedAddressPurpose = addressBookDialog === 'manage-destination' ? 'destination' : 'refund'
  const managedAddressEntries = addressBookEntries.filter((entry) => entry.purpose === managedAddressPurpose)
  const addressDraftCurrency = findCurrency(currencies, addressDraft.ticker, addressDraft.network)

  async function loadSwapHistory() {
    const getHistory = httpsCallable(functions, 'getSwapHistory')
    const { data } = await getHistory({})
    setSwapHistory(data.swaps ?? [])
    setPendingSwaps(data.pendingSwaps ?? [])
  }

  async function closeWaitingSwap(swap) {
    const confirmed = window.confirm(
      `Close tracking for ${swap.fromAmount} ${swap.fromCurrency?.toUpperCase()}?\n\nOnly if you haven't sent funds. This closes tracking in AutoSwap only; it doesn't cancel the ChangeNOW exchange or deactivate its address.`,
    )
    if (!confirmed) return

    setHistoryError('')
    setNotice('')
    setCancellingExchangeId(swap.exchangeId)
    try {
      const cancelPendingSwap = httpsCallable(functions, 'cancelPendingSwap')
      const { data } = await cancelPendingSwap({ exchangeId: swap.exchangeId })
      if (data.historyCreated) {
        setTunnel((current) => current?.id === swap.exchangeId ? null : current)
        setTunnelPreset((current) => tunnel?.id === swap.exchangeId ? null : current)
      }
      await loadSwapHistory()
    } catch (cancelError) {
      setHistoryError(getErrorMessage(cancelError))
    } finally {
      setCancellingExchangeId('')
    }
  }

  async function loadHistoryArchives() {
    setHistoryArchivesLoading(true)
    try {
      const getArchives = httpsCallable(functions, 'getSwapHistoryArchives')
      const { data } = await getArchives({})
      setHistoryArchives(data.archives ?? [])
      setArchiveError('')
    } finally {
      setHistoryArchivesLoading(false)
    }
  }

  async function downloadHistoryArchive(month) {
    setArchiveDownloadBusy(month)
    setArchiveError('')
    try {
      const downloadArchive = httpsCallable(functions, 'downloadSwapHistoryArchive')
      const { data } = await downloadArchive({ month })
      const objectUrl = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = data.filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch {
      setArchiveError("Couldn't download archive. Try again.")
    } finally {
      setArchiveDownloadBusy('')
    }
  }

  async function copyToClipboard(value, label, target) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyToast({ message: `${label} copied`, target })
    } catch {
      const textarea = document.createElement('textarea')
      const previousFocus = document.activeElement
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.append(textarea)
      textarea.select()
      let copied = false
      try {
        copied = document.execCommand('copy')
      } catch {}
      textarea.remove()
      previousFocus?.focus?.()
      setCopyToast(copied
        ? { message: `${label} copied`, target }
        : { message: `Couldn't copy ${label.toLowerCase()}. Select the text to copy it manually.`, target: '', error: true })
    }
  }

  useEffect(() => {
    if (!copyToast) return undefined
    const timeout = window.setTimeout(() => setCopyToast(null), 2200)
    return () => window.clearTimeout(timeout)
  }, [copyToast])

  useEffect(() => {
    if (!openTunnelTimerKey && !confirming) return undefined
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [confirming, openTunnelTimerKey])

  useEffect(() => {
    let active = true
    let polling = false
    let pollOffset = 0
    const locallyClosedCheckAt = new Map()
    const getHistory = httpsCallable(functions, 'getSwapHistory')
    const refreshStatus = httpsCallable(functions, 'refreshSwapStatus')

    async function loadHistory() {
      try {
        const { data } = await getHistory({})
        if (active) {
          setSwapHistory(data.swaps ?? [])
          setPendingSwaps(data.pendingSwaps ?? [])
        }
        return data
      } catch {
        if (active) setHistoryError("Couldn't load activity. Your swap may still be processing. Refresh to retry.")
        return null
      } finally {
        if (active) setHistoryLoading(false)
      }
    }

    async function pollHistory(initialData = null) {
      if (polling) return
      polling = true
      try {
        const data = initialData ?? (await getHistory({})).data
        const swaps = data.swaps ?? []
        const waitingForDeposit = data.pendingSwaps ?? []
        if (!active) return
        setHistoryError('')
        setSwapHistory(swaps)
        setPendingSwaps(waitingForDeposit)
        const outstandingHistory = swaps.filter((swap) => {
          if (!swap.exchangeId) return false
          const isLocallyClosed = isLocallyClosedSwap(swap)
          if (terminalSwapStatuses.has(String(swap.status).toLowerCase()) && !isLocallyClosed) return false
          return !isLocallyClosed || Date.now() - (locallyClosedCheckAt.get(swap.exchangeId) ?? 0) >= 5 * 60 * 1000
        })
        const pending = [...outstandingHistory, ...waitingForDeposit.filter((swap) => swap.exchangeId)]
          .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
        const batch = pending.slice(pollOffset, pollOffset + 5)
        pollOffset = pending.length ? (pollOffset + batch.length) % pending.length : 0
        const statusChecks = await Promise.all(batch.map(async (swap) => {
          const isLocallyClosed = isLocallyClosedSwap(swap)
          if (isLocallyClosed) locallyClosedCheckAt.set(swap.exchangeId, Date.now())
          const requestStartedAt = Date.now()
          try {
            return { exchangeId: swap.exchangeId, requestStartedAt, data: (await refreshStatus({ exchangeId: swap.exchangeId })).data }
          } catch {
            return { exchangeId: swap.exchangeId, requestStartedAt, data: null }
          }
        }))
        const refreshed = statusChecks.flatMap((check) => check.data ? [check.data] : [])
        if (active) {
          setStatusCheckByExchange((current) => {
            const updated = { ...current }
            for (const check of statusChecks) {
              if (check.data) {
                updated[check.exchangeId] = {
                  requestStartedAt: check.requestStartedAt,
                  status: String(check.data.status || '').toLowerCase(),
                }
              }
            }
            return updated
          })
          const updatedHistory = new Map(refreshed.filter((swap) => swap && !swap.pending && !swap.discarded)
            .map((swap) => [swap.exchangeId, swap]))
          setSwapHistory((current) => {
            const merged = current.map((swap) => updatedHistory.get(swap.exchangeId) ?? swap)
            const knownIds = new Set(merged.map((swap) => swap.exchangeId))
            return [...merged, ...refreshed.filter((swap) => swap?.historyCreated && !knownIds.has(swap.exchangeId))]
          })

          const updatedPending = new Map(refreshed.filter((swap) => swap?.pending)
            .map((swap) => [swap.exchangeId, swap]))
          const removedPending = new Set(refreshed.filter((swap) => swap?.historyCreated || swap?.discarded)
            .map((swap) => swap.exchangeId))
          setTunnel((current) => current && removedPending.has(current.id) ? null : current)
          setPendingSwaps((current) => current
            .filter((swap) => !removedPending.has(swap.exchangeId))
            .map((swap) => ({ ...swap, ...updatedPending.get(swap.exchangeId) })))
        }
      } catch {
      } finally {
        polling = false
      }
    }

    loadHistory().then((data) => {
      if (active && data) pollHistory(data)
    })
    loadHistoryArchives().catch(() => {
      if (active) setArchiveError("Couldn't load archives. Current history is unaffected.")
    })
    const interval = window.setInterval(pollHistory, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [user.uid])

  async function refreshPresets({ openNewOnExisting = false } = {}) {
    const saved = await listPresets(user.uid)
    setPresets(saved)
    setPresetsLoadError(false)
    const savedView = getSavedPresetView(user.uid)
    const savedViewExists = saved.some((preset) => preset.id === savedView)

    if (saved.length === 0) {
      setSelectedId('')
      setShowNewPreset(false)
      savePresetView(user.uid, '')
    } else if (savedView === NEW_PRESET_VIEW) {
      setSelectedId(saved.some((preset) => preset.id === selectedId) ? selectedId : saved[0].id)
      setShowNewPreset(true)
    } else if (savedViewExists) {
      setSelectedId(savedView)
      setShowNewPreset(false)
    } else {
      const currentPresetExists = saved.some((preset) => preset.id === selectedId)
      const fallbackPresetId = currentPresetExists ? selectedId : saved[0].id
      setSelectedId(fallbackPresetId)
      if (openNewOnExisting) {
        setForm(emptyPreset)
        setShowNewPreset(true)
        savePresetView(user.uid, NEW_PRESET_VIEW)
      } else {
        savePresetView(user.uid, fallbackPresetId)
      }
    }
  }

  async function retryPresetLoad() {
    setPresetsLoading(true)
    setPresetsLoadError(false)
    try {
      await refreshPresets({ openNewOnExisting: startWithNewPreset })
    } catch {
      setPresetsLoadError(true)
    } finally {
      setPresetsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    setCurrenciesLoading(true)
    setCurrencyError('')
    setAddressBookError('')
    refreshPresets({ openNewOnExisting: startWithNewPreset })
      .catch(() => setPresetsLoadError(true))
      .finally(() => setPresetsLoading(false))
    listAddressBookEntries(user.uid)
      .then((entries) => { if (active) setAddressBookEntries(entries) })
      .catch(() => { if (active) setAddressBookError('Saved addresses could not be loaded.') })

    const getCurrencies = httpsCallable(functions, 'getSwapCurrencies')
    getCurrencies({})
      .then(({ data }) => {
        if (!active) return
        const availableCurrencies = data.currencies ?? []
        setCurrencies(availableCurrencies)
        setCurrencyError('')
        setForm((current) => {
          const hasCurrency = (ticker, network) => availableCurrencies.some((currency) =>
            currency.ticker === ticker && currency.network === network)
          const defaultFrom = availableCurrencies.find((currency) => currency.ticker === 'btc' && currency.network === 'btc')
          const defaultTo = availableCurrencies.find((currency) => currency.ticker === 'eth' && currency.network === 'eth')
          return {
            ...current,
            fromCurrency: hasCurrency(current.fromCurrency, current.fromNetwork) ? current.fromCurrency : defaultFrom?.ticker ?? '',
            fromNetwork: hasCurrency(current.fromCurrency, current.fromNetwork) ? current.fromNetwork : defaultFrom?.network ?? '',
            toCurrency: hasCurrency(current.toCurrency, current.toNetwork) ? current.toCurrency : defaultTo?.ticker ?? '',
            toNetwork: hasCurrency(current.toCurrency, current.toNetwork) ? current.toNetwork : defaultTo?.network ?? '',
          }
        })
      })
      .catch((catalogError) => {
        if (active) setCurrencyError(getErrorMessage(catalogError))
      })
      .finally(() => {
        if (active) setCurrenciesLoading(false)
      })

    return () => { active = false }
  }, [user.uid, currencyReloadKey])

  useEffect(() => {
    if (!showNewPreset || currenciesLoading || !selectedFromCurrency || !selectedToCurrency) {
      setMinimumAmount('')
      setMinimumStatus('idle')
      return undefined
    }

    let active = true
    setMinimumAmount('')
    setMinimumStatus('loading')
    const timeout = window.setTimeout(() => {
      const getMinimum = httpsCallable(functions, 'getSwapMinimum')
      getMinimum({
        fromCurrency: form.fromCurrency,
        fromNetwork: form.fromNetwork,
        toCurrency: form.toCurrency,
        toNetwork: form.toNetwork,
      })
        .then(({ data }) => {
          if (!active) return
          setMinimumAmount(data.minimumAmount)
          setMinimumStatus('ready')
        })
        .catch(() => {
          if (!active) return
          setMinimumAmount('')
          setMinimumStatus('error')
        })
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [currenciesLoading, form.fromCurrency, form.fromNetwork, form.toCurrency, form.toNetwork, selectedFromCurrency, selectedToCurrency, showNewPreset])

  function updateForm(event) {
    const { name, value } = event.target
    const receiveAssetChanged = name === 'toCurrency' || name === 'toNetwork'
    const sendAssetChanged = name === 'fromCurrency' || name === 'fromNetwork'
    const destinationChanged = receiveAssetChanged || name === 'destinationAddress'
    const refundChanged = sendAssetChanged || name === 'refundAddress'
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(receiveAssetChanged ? { destinationAddress: '' } : {}),
      ...(destinationChanged ? { destinationExtraId: '' } : {}),
      ...(sendAssetChanged ? { refundAddress: '' } : {}),
      ...(refundChanged ? { refundExtraId: '' } : {}),
    }))
    if (destinationChanged) setSwapDestinationExtraId('')
    if (refundChanged) setSwapRefundExtraId('')
    if (destinationChanged || refundChanged) {
      setQuote(null)
      setConfirming(false)
      setError('')
    }
  }

  function updateSelectedCurrency(side, currency) {
    if (!currency) return

    setForm((current) => ({
      ...current,
      [`${side}Currency`]: currency.ticker,
      [`${side}Network`]: currency.network,
      ...(side === 'to' ? { destinationAddress: '', destinationExtraId: '' } : {}),
      ...(side === 'from' ? { refundAddress: '', refundExtraId: '' } : {}),
    }))
    if (side === 'from') {
      setFromSearch('')
      setSwapRefundExtraId('')
    }
    if (side === 'to') {
      setToSearch('')
      setSwapDestinationExtraId('')
    }
    setQuote(null)
    setConfirming(false)
    setError('')
  }

  function handleAssetSelectKeyDown(side, event) {
    if (event.key !== 'Enter' || event.keyCode !== 229 || event.target.tagName !== 'INPUT') return
    event.preventDefault()
    event.stopPropagation()
    const selectRef = side === 'from' ? fromAssetSelectRef : toAssetSelectRef
    const focusedCurrency = selectRef.current?.state?.focusedOption
    if (focusedCurrency) updateSelectedCurrency(side, focusedCurrency)
  }

  function loadAddress(target, entryId) {
    const entry = addressBookEntries.find((savedEntry) => savedEntry.id === entryId)
    if (!entry) return
    setForm((current) => ({
      ...current,
      ...(target === 'destination'
        ? { destinationAddress: entry.address, destinationExtraId: '' }
        : { refundAddress: entry.address, refundExtraId: '' }),
    }))
    if (target === 'destination') setSwapDestinationExtraId('')
    else setSwapRefundExtraId('')
  }

  function beginSaveAddress(purpose) {
    const currency = purpose === 'destination' ? selectedToCurrency : selectedFromCurrency
    const address = purpose === 'destination' ? form.destinationAddress : form.refundAddress
    if (!currency || !address.trim()) {
      setError('Enter an address before saving it to your address book.')
      return
    }
    setAddressDraft({ label: '', address: address.trim(), extraId: '', ticker: currency.ticker, network: currency.network, purpose })
    setAddressBookError('')
    setAddressBookDialog('save')
  }

  async function saveAddress(event) {
    event.preventDefault()
    setAddressBookBusy(true)
    setAddressBookError('')
    try {
      await createAddressBookEntry(user.uid, {
        ...addressDraft,
        label: addressDraft.label.trim(),
        address: addressDraft.address.trim(),
        extraId: '',
      })
      setAddressBookEntries(await listAddressBookEntries(user.uid))
      setAddressBookDialog('')
    } catch (saveError) {
      setAddressBookError(getErrorMessage(saveError))
    } finally {
      setAddressBookBusy(false)
    }
  }

  async function removeAddress(entry) {
    if (!window.confirm(`Remove “${entry.label}” from your address book?`)) return
    setAddressBookBusy(true)
    setAddressBookError('')
    try {
      await deleteAddressBookEntry(user.uid, entry.id)
      setAddressBookEntries((entries) => entries.filter((savedEntry) => savedEntry.id !== entry.id))
    } catch (removeError) {
      setAddressBookError(getErrorMessage(removeError))
    } finally {
      setAddressBookBusy(false)
    }
  }

  function beginEditPreset() {
    if (!selectedPreset) return
    setForm({
      fromCurrency: selectedPreset.fromCurrency ?? emptyPreset.fromCurrency,
      fromNetwork: selectedPreset.fromNetwork ?? emptyPreset.fromNetwork,
      toCurrency: selectedPreset.toCurrency ?? emptyPreset.toCurrency,
      toNetwork: selectedPreset.toNetwork ?? emptyPreset.toNetwork,
      fromAmount: selectedPreset.fromAmount ?? '',
      destinationAddress: selectedPreset.destinationAddress ?? '',
      destinationExtraId: '',
      refundAddress: selectedPreset.refundAddress ?? '',
      refundExtraId: '',
    })
    setSwapDestinationExtraId('')
    setSwapRefundExtraId('')
    setEditingPresetId(selectedPreset.id)
    setFromSearch('')
    setToSearch('')
    setQuote(null)
    setConfirming(false)
    setNotice('')
    setError('')
    setHistoryError('')
    setShowNewPreset(true)
  }

  function cancelPresetForm() {
    setShowNewPreset(false)
    savePresetView(user.uid, selectedId)
    setEditingPresetId('')
    setForm(emptyPreset)
    setFromSearch('')
    setToSearch('')
    setSwapDestinationExtraId('')
    setSwapRefundExtraId('')
    setError('')
    setHistoryError('')
  }

  function toggleNewPreset() {
    if (showNewPreset) {
      cancelPresetForm()
      return
    }
    setEditingPresetId('')
    setForm(emptyPreset)
    setFromSearch('')
    setToSearch('')
    setSwapDestinationExtraId('')
    setSwapRefundExtraId('')
    setError('')
    setNotice('')
    setHistoryError('')
    savePresetView(user.uid, NEW_PRESET_VIEW)
    setShowNewPreset(true)
  }

  async function savePreset(event) {
    event.preventDefault()
    setError('')
    if (!selectedFromCurrency?.canSell || !selectedToCurrency?.canBuy) {
      setError('Choose a send asset and receive asset before saving this preset.')
      return
    }
    setBusy(true)
    try {
      const preset = {
        ...form,
        name: getPresetName(form),
        destinationAddress: form.destinationAddress.trim(),
        fromAmount: form.fromAmount.trim(),
        destinationExtraId: '',
        refundAddress: form.refundAddress.trim(),
        refundExtraId: '',
      }
      let savedPresetId = editingPresetId
      if (savedPresetId) {
        await updatePreset(user.uid, savedPresetId, preset)
      } else {
        savedPresetId = await createPreset(user.uid, preset)
      }
      await refreshPresets()
      if (savedPresetId) {
        setSelectedId(savedPresetId)
        savePresetView(user.uid, savedPresetId)
      }
      setQuote(null)
      setConfirming(false)
      setNotice('')
      setShowNewPreset(false)
      setEditingPresetId('')
      setForm(emptyPreset)
      setSwapDestinationExtraId(form.destinationExtraId.trim())
      setSwapRefundExtraId(form.refundAddress.trim() ? form.refundExtraId.trim() : '')
      setFromSearch('')
      setToSearch('')
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function removePreset() {
    if (!selectedPreset || !window.confirm(`Delete “${getPresetName(selectedPreset)}”?`)) return
    setError('')
    try {
      await deletePreset(user.uid, selectedPreset.id)
      setTunnel(null)
      setTunnelPreset(null)
      await refreshPresets()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    }
  }

  async function createTunnel(preset, quoteId) {
    const create = httpsCallable(functions, 'createSwapTunnel')
    const result = await create({
      fromCurrency: preset.fromCurrency,
      fromNetwork: preset.fromNetwork,
      toCurrency: preset.toCurrency,
      toNetwork: preset.toNetwork,
      fromAmount: preset.fromAmount,
      toAddress: preset.destinationAddress,
      toExtraId: swapDestinationExtraId.trim(),
      refundAddress: preset.refundAddress,
      refundExtraId: preset.refundAddress ? swapRefundExtraId.trim() : '',
      quoteId,
      presetId: preset.id,
    })
    return result.data
  }

  async function requestQuote() {
    if (!selectedPreset) return
    if (currenciesLoading || !selectedPresetToCurrency) {
      setError('Assets are still loading. Try again shortly.')
      return
    }
    if (selectedPresetToCurrency.requiresExtraId && !swapDestinationExtraId.trim()) {
      setError(`Enter the current ${selectedPreset.toCurrency.toUpperCase()} memo or tag for ${selectedPreset.toNetwork.toUpperCase()} to continue.`)
      return
    }
    if (selectedPresetRefundExtraIdRequired && !swapRefundExtraId.trim()) {
      setError(`Enter the current refund memo or tag for ${selectedPreset.fromCurrency.toUpperCase()} on ${selectedPreset.fromNetwork.toUpperCase()}.`)
      return
    }
    setBusy(true)
    setError('')
    setNotice('Checking pair and live estimate…')
    setQuote(null)

    try {
      const getQuote = httpsCallable(functions, 'getSwapQuote')
      const result = await getQuote({
        fromCurrency: selectedPreset.fromCurrency,
        fromNetwork: selectedPreset.fromNetwork,
        toCurrency: selectedPreset.toCurrency,
        toNetwork: selectedPreset.toNetwork,
        fromAmount: selectedPreset.fromAmount,
        toAddress: selectedPreset.destinationAddress,
        toExtraId: swapDestinationExtraId.trim(),
        refundAddress: selectedPreset.refundAddress,
        refundExtraId: selectedPreset.refundAddress ? swapRefundExtraId.trim() : '',
        presetId: selectedPreset.id,
      })
      setClockNow(Date.now())
      setQuote(result.data)
      setConfirming(true)
      setNotice('')
    } catch (quoteError) {
      setError(`No live quote; no deposit address was created. Don't send funds. ${getErrorMessage(quoteError)}`)
      setNotice('')
    } finally {
      setBusy(false)
    }
  }

  async function confirmSwap() {
    if (!selectedPreset || !quote?.quoteId) return
    if (waitingTunnelCount >= MAX_WAITING_TUNNELS) {
      setError('Three tunnels are waiting for deposits. Wait or close an unfunded tunnel before opening another.')
      return
    }
    if (Date.now() >= quote.quoteExpiresAt) {
      setQuote(null)
      setConfirming(false)
      setError('Quote expired. Request a new quote before creating the tunnel.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('Creating a swap tunnel…')
    setConfirming(false)
    setTunnel(null)
    setTunnelPreset(null)

    try {
      const created = await createTunnel(selectedPreset, quote.quoteId)
      if (!created.payinAddress) throw new Error('ChangeNOW did not return a deposit address. The exchange may not support this route.')
      const tunnelAccessExpiresAt = created.accessExpiresAt ?? Date.now() + TUNNEL_ACCESS_TTL_MS
      setTunnel({ ...created, presetId: selectedPreset.id, accessExpiresAt: tunnelAccessExpiresAt })
      setTunnelPreset(selectedPreset)
      setQuote(null)
      setSwapDestinationExtraId('')
      setSwapRefundExtraId('')
      setHistoryError(created.trackingSaved ? '' : "Tracking couldn't be saved. Keep the Exchange ID to check status with ChangeNOW.")
      if (created.trackingSaved && created.id) {
        setPendingSwaps((current) => [{
          id: created.id,
          exchangeId: created.id,
          presetId: selectedPreset.id,
          accessExpiresAt: tunnelAccessExpiresAt,
          status: created.status || 'waiting',
          payinAddress: created.payinAddress,
          payinExtraId: created.payinExtraId,
          fromCurrency: selectedPreset.fromCurrency,
          fromNetwork: selectedPreset.fromNetwork,
          fromAmount: selectedPreset.fromAmount,
          toCurrency: selectedPreset.toCurrency,
          toNetwork: selectedPreset.toNetwork,
          estimatedAmount: quote.estimatedAmount,
          createdAt: tunnelAccessExpiresAt - TUNNEL_ACCESS_TTL_MS,
        }, ...current.filter((swap) => swap.exchangeId !== created.id)])
        loadSwapHistory().catch(() => setHistoryError("Couldn't refresh activity. Try again shortly."))
      }

      setNotice('')
    } catch (swapError) {
      setError(`No deposit address was created. Don't send funds. ${getErrorMessage(swapError)}`)
      setNotice('')
      setQuote(null)
    } finally {
      setBusy(false)
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

      <main className="workspace">
        <aside className="route-rail">
          <div className="rail-heading">
            <div><p className="eyebrow">YOUR WORKSPACE</p><h2>Saved Routes</h2></div>
            <button className="icon-button" aria-label="Create route" title="Create route" onClick={toggleNewPreset} type="button">+</button>
          </div>
          {presetsLoading && <p className="empty-routes" role="status">Loading saved routes…</p>}
          {!presetsLoading && !presetsLoadError && presets.length === 0 && <p className="empty-routes">No routes saved yet.</p>}
          <nav className={`route-list ${routeListScrolling ? 'route-list-scrolling' : ''}`} aria-label="Saved routes" onScroll={handleRouteListScroll}>
            {presets.map((preset) => (
              <button
                className={`route-item ${selectedId === preset.id ? 'route-item-active' : ''}`}
                key={preset.id}
                onClick={() => {
                  setSelectedId(preset.id)
                  setSwapDestinationExtraId('')
                  setSwapRefundExtraId('')
                  savePresetView(user.uid, preset.id)
                  setShowNewPreset(false)
                  setEditingPresetId('')
                  setForm(emptyPreset)
                  setQuote(null)
                  setTunnel(null)
                  setTunnelPreset(null)
                  setNotice('')
                  setError('')
                  setHistoryError('')
                }}
                type="button"
              >
                <span className="route-item-path">{preset.fromCurrency?.toUpperCase()} ({preset.fromNetwork?.toUpperCase()}) → {preset.toCurrency?.toUpperCase()} ({preset.toNetwork?.toUpperCase()})</span>
              </button>
            ))}
          </nav>
          <div className="rail-note"><span className="status-led" /> Route details are confirmed before each tunnel is created.</div>
        </aside>

        <section className="desk-content">
          <div className="page-heading">
            <div>
              <div className="provider-attribution">
                <p className="eyebrow">POWERED BY CHANGENOW</p>
                <a className="provider-site-icon" aria-label="Visit ChangeNOW's website" href="https://changenow.io/" rel="noopener noreferrer" target="_blank" title="Visit ChangeNOW">
                  <img src="https://changenow.io/favicon.ico" alt="" />
                </a>
              </div>
              <h1>Route Desk</h1>
            </div>
            {selectedPreset && !showNewPreset && <button className="button button-quiet delete-button" onClick={removePreset} type="button">Delete route</button>}
          </div>

          {!isFirebaseConfigured && <div className="notice notice-warning">Firebase isn't configured. Add VITE_FIREBASE_* settings to continue.</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {addressBookError && <div className="notice notice-error" role="alert">{addressBookError}</div>}

          {showNewPreset && (
            <section className="panel new-route-panel">
              <div className="panel-heading"><div><p className="eyebrow">{editingPresetId ? 'EDIT PRESET' : 'NEW PRESET'}</p><h2>{editingPresetId ? 'Edit Saved Route' : 'Route Details'}</h2></div></div>
              <form className="preset-form" onSubmit={savePreset}>
                {currenciesLoading && <p className="field-note field-wide" role="status">Loading ChangeNOW assets…</p>}
                {currencyError && <div className="notice notice-error field-wide" role="alert">{currencyError}<button className="button button-quiet" onClick={() => setCurrencyReloadKey((key) => key + 1)} type="button">Reload assets</button></div>}
                <label className="field-wide">Send crypto from
                  <Select
                    aria-label="Send crypto from"
                    className="asset-select"
                    classNamePrefix="asset-select"
                    inputId="send-asset-select"
                    onKeyDown={(event) => handleAssetSelectKeyDown('from', event)}
                    ref={fromAssetSelectRef}
                    inputValue={fromSearch}
                    isDisabled={currenciesLoading || fromCurrencies.length === 0}
                    isSearchable
                    isClearable={false}
                    maxMenuHeight={260}
                    menuPlacement="auto"
                    menuPosition="fixed"
                    menuPortalTarget={document.body}
                    noOptionsMessage={() => 'No matching send assets. Try another name or network.'}
                    onChange={(currency) => updateSelectedCurrency('from', currency)}
                    onInputChange={(value, action) => {
                      if (action.action === 'input-change') setFromSearch(value)
                      return value
                    }}
                    options={currencyGroups(matchingFromCurrencies, Boolean(fromSearchLower))}
                    placeholder={currenciesLoading ? 'Loading assets…' : 'Search by coin, ticker, or network'}
                    value={selectedFromCurrency}
                    filterOption={null}
                    getOptionValue={(currency) => currency.id}
                    getOptionLabel={(currency) => `${currency.name} ${currency.ticker} ${currency.network}`}
                    formatOptionLabel={formatCurrencyOption}
                    styles={assetSelectStyles}
                  />
                </label>
                <p className="field-note field-wide" role="status">{fromSearchLower ? `${matchingFromCurrencies.length} matches` : `Popular first · ${fromCurrencies.length.toLocaleString()} assets available to send`}</p>
                <label className="field-wide">Receive crypto
                  <Select
                    aria-label="Receive crypto"
                    className="asset-select"
                    classNamePrefix="asset-select"
                    inputId="receive-asset-select"
                    onKeyDown={(event) => handleAssetSelectKeyDown('to', event)}
                    ref={toAssetSelectRef}
                    inputValue={toSearch}
                    isDisabled={currenciesLoading || toCurrencies.length === 0}
                    isSearchable
                    isClearable={false}
                    maxMenuHeight={260}
                    menuPlacement="auto"
                    menuPosition="fixed"
                    menuPortalTarget={document.body}
                    noOptionsMessage={() => 'No matching receive assets. Try another name or network.'}
                    onChange={(currency) => updateSelectedCurrency('to', currency)}
                    onInputChange={(value, action) => {
                      if (action.action === 'input-change') setToSearch(value)
                      return value
                    }}
                    options={currencyGroups(matchingToCurrencies, Boolean(toSearchLower))}
                    placeholder={currenciesLoading ? 'Loading assets…' : 'Search by coin, ticker, or network'}
                    value={selectedToCurrency}
                    filterOption={null}
                    getOptionValue={(currency) => currency.id}
                    getOptionLabel={(currency) => `${currency.name} ${currency.ticker} ${currency.network}`}
                    formatOptionLabel={formatCurrencyOption}
                    styles={assetSelectStyles}
                  />
                </label>
                <div className="flow-destination field-wide">
                  <span>RECEIVING AT</span>
                  <strong>{formDestinationWalletName}</strong>
                  <p>Send the selected asset and network to ChangeNOW. It sends the exchanged asset to this destination.</p>
                </div>
                <label>Amount to send ({form.fromCurrency.toUpperCase()})<input aria-describedby="minimum-send-note" name="fromAmount" inputMode="decimal" value={form.fromAmount} onChange={updateForm} placeholder="0.05" required /></label>
                <p className="field-note field-wide" id="minimum-send-note" role="status">
                  {minimumStatus === 'loading' && 'Checking the minimum for this pair… '}
                  {minimumStatus === 'ready' && `Minimum: ${minimumAmount} ${form.fromCurrency.toUpperCase()}. `}
                  {minimumStatus === 'error' && 'Minimum unavailable; ChangeNOW will check when you request a quote. '}
                  Enter the send amount. The estimate appears with your quote.
                </p>
                <label className="field-wide">Destination address<input name="destinationAddress" value={form.destinationAddress} onChange={updateForm} autoComplete="off" placeholder="Address on the selected receive network" required /></label>
                {(selectedToCurrency?.requiresExtraId || selectedToCurrency?.supportsExtraId) && <label className="field-wide preset-memo-field">Destination memo or tag{selectedToCurrency.requiresExtraId ? ' (Required for each swap)' : ' (Optional)'}<input autoComplete="off" name="destinationExtraId" onChange={updateForm} placeholder={selectedToCurrency.requiresExtraId ? 'Enter the current destination memo or tag' : 'Enter an optional destination memo or tag'} value={form.destinationExtraId} /><small>{selectedToCurrency.requiresExtraId ? 'A value is required before requesting a quote.' : 'Only enter one if ChangeNOW or the receiving wallet provides it.'} This value applies to the swap you open now and will not be saved with the preset.</small></label>}
                <div className="address-tools field-wide">
                  <select aria-label="Load a saved destination address" value="" onChange={(event) => loadAddress('destination', event.target.value)}>
                    <option value="">Load a saved destination address…</option>
                    {destinationAddressEntries.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
                  </select>
                  <button className="button button-quiet" onClick={() => beginSaveAddress('destination')} type="button">Save destination address</button>
                  <button className="button button-quiet" onClick={() => setAddressBookDialog('manage-destination')} type="button">Manage address book</button>
                </div>
                <label className="field-wide">Refund address <span className="optional-label">Optional. Used only if the exchange refunds the swap.</span><input name="refundAddress" value={form.refundAddress} onChange={updateForm} autoComplete="off" placeholder="Crypto address on the send network" /></label>
                {form.refundAddress && (selectedFromCurrency?.requiresExtraId || selectedFromCurrency?.supportsExtraId) && <label className="field-wide preset-memo-field">Refund memo or tag{selectedFromCurrency.requiresExtraId ? ' (Required for this refund address)' : ' (Optional)'}<input autoComplete="off" name="refundExtraId" onChange={updateForm} placeholder={selectedFromCurrency.requiresExtraId ? 'Enter the current refund memo or tag' : 'Enter an optional refund memo or tag'} value={form.refundExtraId} /><small>Used only with this refund address for the swap you open now. This value will not be saved with the preset.</small></label>}
                <div className="address-tools field-wide">
                  <select aria-label="Load a saved refund address" value="" onChange={(event) => loadAddress('refund', event.target.value)}>
                    <option value="">Load a saved refund address…</option>
                    {refundAddressEntries.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
                  </select>
                  <button className="button button-quiet" onClick={() => beginSaveAddress('refund')} type="button">Save refund address</button>
                  <button className="button button-quiet" onClick={() => setAddressBookDialog('manage-refund')} type="button">Manage address book</button>
                </div>
                <p className="field-note field-wide">Use a wallet that supports this asset and network. Review the live quote before opening a tunnel.</p>
                <div className="form-actions field-wide"><button className="button button-quiet" disabled={busy} onClick={cancelPresetForm} type="button">Cancel</button><button className="button button-primary" disabled={busy || currenciesLoading || !selectedFromCurrency?.canSell || !selectedToCurrency?.canBuy} type="submit">{busy ? 'Saving…' : editingPresetId ? 'Save changes' : 'Save preset'}</button></div>
              </form>
            </section>
          )}

          {presetsLoading && !showNewPreset && (
            <section className="preset-loading" role="status">Loading saved routes…</section>
          )}

          {!presetsLoading && presetsLoadError && !showNewPreset && (
            <section className="empty-state">
              <p className="eyebrow">ROUTES UNAVAILABLE</p>
              <h2>Saved routes couldn’t load</h2>
              <p>Check your connection and try again.</p>
              <button className="button button-primary" disabled={presetsLoading} onClick={retryPresetLoad} type="button">Try again</button>
            </section>
          )}

          {!presetsLoading && !presetsLoadError && !selectedPreset && !showNewPreset && (
            <section className="empty-state"><div className="empty-glyph" aria-hidden="true">↗</div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Create Your First Route</h2><p>Save a route to reuse its details.</p><button className="button button-primary" onClick={toggleNewPreset} type="button">Create a route <span aria-hidden="true">+</span></button></section>
          )}

          {selectedPreset && !showNewPreset && (
            <>
              <section className="route-summary">
                <div className="summary-origin"><span className="summary-label">FROM</span><strong>{getSourceWalletName(selectedPreset)}</strong></div>
                <div className="summary-destination"><span className="summary-label">TO</span><strong>{getDestinationWalletName(selectedPreset)}</strong></div>
              </section>
              <section className="panel active-route-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">ACTIVE PRESET</p>
                    <h2 className="active-preset-symbols" aria-label={getPresetName(selectedPreset)}>
                      <span className="active-preset-symbol" title={getCurrencyTooltip(selectedPresetFromCurrency, selectedPreset.fromCurrency, selectedPreset.fromNetwork)}>
                        <CurrencyLogo currency={selectedPresetFromCurrency ?? { ticker: selectedPreset.fromCurrency }} className="active-preset-logo" />
                      </span>
                      <span className="active-preset-direction" aria-hidden="true">→</span>
                      <span className="active-preset-symbol" title={getCurrencyTooltip(selectedPresetToCurrency, selectedPreset.toCurrency, selectedPreset.toNetwork)}>
                        <CurrencyLogo currency={selectedPresetToCurrency ?? { ticker: selectedPreset.toCurrency }} className="active-preset-logo" />
                      </span>
                    </h2>
                  </div>
                  <span className="panel-index">01 / ROUTE</span>
                </div>
                {selectedPresetToCurrency?.requiresExtraId && <div className="notice notice-warning preset-extra-id-warning" role="status">Enter the current destination memo or tag. It isn't saved with the preset.</div>}
                {(selectedPresetToCurrency?.requiresExtraId || selectedPresetToCurrency?.supportsExtraId || (selectedPreset?.refundAddress && (selectedPresetFromCurrency?.requiresExtraId || selectedPresetFromCurrency?.supportsExtraId))) && <div className="preset-extra-id-fields">
                  {(selectedPresetToCurrency?.requiresExtraId || selectedPresetToCurrency?.supportsExtraId) && (
                    <label>Destination memo or tag{selectedPresetToCurrency.requiresExtraId ? ' (Required)' : ' (Optional)'}
                      <input autoComplete="off" onChange={(event) => { setSwapDestinationExtraId(event.target.value); setQuote(null); setConfirming(false); setError('') }} placeholder={selectedPresetToCurrency.requiresExtraId ? 'Enter the current required memo or tag' : 'Enter a memo or tag if required by this deposit'} required={selectedPresetToCurrency.requiresExtraId} value={swapDestinationExtraId} />
                      <small>Current value only; not saved with the preset.</small>
                    </label>
                  )}
                  {selectedPreset?.refundAddress && (selectedPresetFromCurrency?.requiresExtraId || selectedPresetFromCurrency?.supportsExtraId) && (
                    <label>Refund memo or tag{selectedPresetRefundExtraIdRequired ? ' (Required)' : ' (Optional)'}
                      <input autoComplete="off" onChange={(event) => { setSwapRefundExtraId(event.target.value); setQuote(null); setConfirming(false); setError('') }} placeholder={selectedPresetRefundExtraIdRequired ? 'Enter the current required refund memo or tag' : 'Enter a refund memo or tag if required'} required={selectedPresetRefundExtraIdRequired} value={swapRefundExtraId} />
                      <small>Used only for refunds; not saved with the preset.</small>
                    </label>
                  )}
                </div>}
                <div className="detail-grid">
                  <div><span>Send amount</span><strong>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()}</strong></div>
                  <div><span>Deposit network</span><strong>{selectedPreset.fromNetwork?.toUpperCase()}</strong></div>
                  <div><span>Destination network</span><strong>{selectedPreset.toNetwork?.toUpperCase()}</strong></div>
                  <div><span>Delivery address</span><strong className="address-value">{selectedPreset.destinationAddress}</strong></div>
                </div>
                <div className="panel-footer"><p>ChangeNOW checks the current minimum and estimates the receive amount before any deposit tunnel is created.</p><div className="preset-actions"><button className="button button-quiet" disabled={busy} onClick={beginEditPreset} type="button">Edit preset</button><button className="button button-primary" disabled={busy} onClick={requestQuote} type="button">{busy ? 'Getting quote…' : 'Review swap'} <span aria-hidden="true">↗</span></button></div></div>
              </section>
            </>
          )}

          {notice && !showNewPreset && <div className="notice notice-success" role="status">{notice}</div>}

          {openTunnels.length > 0 && (
            <section className="panel tunnel-panel">
              <div className="panel-heading"><div><p className="eyebrow">DEPOSIT DETAILS</p><h2>Open Tunnels</h2></div><span className="live-badge">{openTunnels.length} {openTunnels.length === 1 ? 'ADDRESS' : 'ADDRESSES'} AVAILABLE</span></div>
              <div className="open-tunnel-list">
                {openTunnels.map((openTunnel) => {
                  const route = `${openTunnel.fromCurrency?.toUpperCase()} (${openTunnel.fromNetwork?.toUpperCase()}) to ${openTunnel.toCurrency?.toUpperCase()} (${openTunnel.toNetwork?.toUpperCase()})`
                  const addressTarget = `address-${openTunnel.id}`
                  const memoTarget = `memo-${openTunnel.id}`
                  const tunnelExpired = clockNow >= openTunnel.accessExpiresAt
                  const exchangeId = openTunnel.exchangeId ?? openTunnel.id
                  const statusCheck = statusCheckByExchange[exchangeId]
                  const canCancelTunnel = tunnelExpired
                    && String(openTunnel.status || 'waiting').toLowerCase() === 'waiting'
                    && statusCheck?.status === 'waiting'
                    && statusCheck.requestStartedAt >= openTunnel.accessExpiresAt
                  return (
                    <details className="open-tunnel-item" key={openTunnel.id ?? openTunnel.payinAddress} open={openTunnel.id === tunnel?.id}>
                      <summary className="open-tunnel-heading"><div><strong>{route}</strong><small>{getSourceWalletName(openTunnel)}{openTunnel.fromAmount ? ` · ${openTunnel.fromAmount} ${openTunnel.fromCurrency?.toUpperCase()}` : ''}</small></div><span className={`live-badge ${tunnelExpired ? 'live-badge-expired' : ''}`}>{tunnelExpired ? 'EXPIRED · CLOSE' : formatTunnelTimeRemaining(openTunnel.accessExpiresAt, clockNow)}</span></summary>
                      <div className="open-tunnel-details">
                        {tunnelExpired ? (
                          <>
                            <div className="notice notice-warning">Address window ended. Don’t send here. If you already sent funds, don’t resend or close tracking.</div>
                            {!canCancelTunnel && <p className="field-note">Checking status. Close is available only if ChangeNOW still shows Waiting.</p>}
                          </>
                        ) : (
                          <>
                            <div className="notice notice-warning single-use-warning" role="note">Send only {openTunnel.fromCurrency?.toUpperCase()} on {openTunnel.fromNetwork?.toUpperCase()}. This address is for this exchange only; sending another asset or network may permanently lose funds.</div>
                            <div className="deposit-address"><span>Deposit address</span><div className="deposit-value-row"><code>{openTunnel.payinAddress}</code><button aria-label={copyToast?.target === addressTarget ? 'Address copied to clipboard' : 'Copy address'} aria-live="polite" className={`button button-quiet ${copyToast?.target === addressTarget ? 'button-copy-confirmed' : ''}`} onClick={() => copyToClipboard(openTunnel.payinAddress, 'Address', addressTarget)} type="button">Copy</button></div></div>
                            {openTunnel.payinExtraId && <div className="deposit-address"><span>Required deposit memo or tag</span><div className="deposit-value-row"><code>{openTunnel.payinExtraId}</code><button aria-label={copyToast?.target === memoTarget ? 'Memo or tag copied to clipboard' : 'Copy memo or tag'} aria-live="polite" className={`button button-quiet ${copyToast?.target === memoTarget ? 'button-copy-confirmed' : ''}`} onClick={() => copyToClipboard(openTunnel.payinExtraId, 'Memo or tag', memoTarget)} type="button">Copy</button></div></div>}
                            {(openTunnel.transactionHash || openTunnel.payinHash) && <div className="transaction-hash"><span>Wallet transaction</span><code>{openTunnel.transactionHash ?? openTunnel.payinHash}</code></div>}
                          </>
                        )}
                        {(() => {
                          const progress = getSwapProgress(openTunnel.status, openTunnel.cancellationReason)
                          return (
                            <section className={`swap-progress ${progress.step < 0 ? 'swap-progress-alert' : ''}`} aria-label="Swap status">
                              <div className="swap-progress-current" role="status" aria-live="polite">
                                <span className="swap-progress-led" aria-hidden="true" />
                                <div><strong>{progress.label}</strong><p>{progress.detail}</p></div>
                              </div>
                              {progress.step >= 0 && (
                                <ol className="swap-progress-steps" aria-label="Swap progress">
                                  {swapProgressSteps.map((step, index) => {
                                    const complete = index < progress.step || progress.step === swapProgressSteps.length - 1
                                    const current = index === progress.step && !complete
                                    return (
                                      <li className={`${complete ? 'is-complete' : ''} ${current ? 'is-current' : ''}`} aria-current={current ? 'step' : undefined} key={step}>
                                        <span>{complete ? '✓' : index + 1}</span><small>{step}</small>
                                      </li>
                                    )
                                  })}
                                </ol>
                              )}
                            </section>
                          )
                        })()}
                        {(openTunnel.id || canCancelTunnel) && (
                          <div className="tunnel-footer">
                            {openTunnel.id && <p className="tunnel-exchange-id">Exchange ID: <code>{openTunnel.id}</code></p>}
                            {canCancelTunnel && <button className="button button-quiet open-tunnel-cancel" disabled={cancellingExchangeId !== ''} onClick={() => closeWaitingSwap({ ...openTunnel, exchangeId })} title="Closes tracking in AutoSwap only; this does not cancel the ChangeNOW exchange." type="button">{cancellingExchangeId === exchangeId ? 'Checking…' : 'Close in AutoSwap'}</button>}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            </section>
          )}

          <section className="panel history-panel" aria-labelledby="swap-history-title">
            <div className="panel-heading">
              <div><p className="eyebrow">EXCHANGE ACTIVITY</p><h2 id="swap-history-title">Swap History</h2></div>
              <label className="history-filter" htmlFor="swap-history-filter">
                <span>Show</span>
                <select id="swap-history-filter" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>
                  <option value="all">All swaps</option>
                  <option value="in-progress-completed">In progress &amp; completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                  <option value="failed">Failed / refunded</option>
                </select>
              </label>
            </div>
            {historyError && !showNewPreset && <div className="notice notice-warning" role="status">{historyError}</div>}
            {historyLoading ? <p className="history-empty">Loading activity…</p> : filteredSwapHistory.length === 0 ? <p className="history-empty">{visibleSwapHistory.length === 0 ? 'New swaps appear here. Close expired tunnels you did not fund.' : 'No swaps match this filter.'}</p> : (
              <>
                <div className="history-list">
                  {recentSwapHistory.map((swap) => (
                    <SwapHistoryItem key={swap.id} swap={swap} />
                  ))}
                </div>
                {olderSwapHistory.length > 0 && (
                  <details className="history-log-more">
                    <summary>Older swaps ({olderSwapHistory.length})</summary>
                    <div className="history-log-scroll" role="region" aria-label="Older swap history">
                    <div className="history-list">
                      {olderSwapHistory.map((swap) => (
                        <SwapHistoryItem key={swap.id} swap={swap} />
                      ))}
                    </div>
                    </div>
                  </details>
                )}
              </>
            )}
            <div className="history-archives">
              <div className="history-archives-heading">
                <div><strong>Monthly Swap Archives</strong><small>Crypto-only CSVs; no fiat values or cost basis.</small></div>
                <button className="button button-quiet" disabled={historyLoading || historyArchivesLoading} onClick={() => loadHistoryArchives().catch(() => setArchiveError("Couldn't load archives."))} type="button">{historyArchivesLoading ? 'Refreshing…' : 'Refresh'}</button>
              </div>
              {archiveError && <div className="notice notice-warning" role="status">{archiveError}</div>}
              {historyArchives.length === 0
                ? !archiveError && <p className="history-empty">No archives yet.</p>
                : <ul className="history-archive-list">{historyArchives.map((month) => (
                  <li className="history-archive-item" key={month}>
                    <span>{new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
                    <button className="button button-quiet" disabled={archiveDownloadBusy !== ''} onClick={() => downloadHistoryArchive(month)} type="button">{archiveDownloadBusy === month ? 'Preparing…' : 'Download CSV'}</button>
                  </li>
                ))}</ul>}
            </div>
          </section>
        </section>
      </main>

      {addressBookDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddressBookDialog('') }}>
          <section className="confirm-modal address-book-modal" role="dialog" aria-modal="true" aria-labelledby="address-book-title">
            <p className="eyebrow">PRIVATE TO YOUR ACCOUNT</p>
            <h2 id="address-book-title">{addressBookDialog === 'save' ? 'Save Address' : `${managedAddressPurpose === 'destination' ? 'Destination' : 'Refund'} Address Book`}</h2>
            {addressBookDialog === 'save' ? (
              <form className="address-save-form" onSubmit={saveAddress}>
                <p className="muted">{addressDraft.ticker.toUpperCase()} on {addressDraft.network.toUpperCase()} · {addressDraft.purpose === 'destination' ? 'Destination' : 'Refund'} address</p>
                <label>Address label<input autoFocus maxLength="48" onChange={(event) => setAddressDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="For example, Main wallet" required value={addressDraft.label} /></label>
                <div className="address-preview"><code>{addressDraft.address}</code></div>
                {(addressDraftCurrency?.requiresExtraId || addressDraftCurrency?.supportsExtraId) && <p className="notice notice-warning address-book-tag-notice">Memos and tags are not saved with addresses. Enter the current value for each swap.</p>}
                <div className="form-actions"><button className="button button-quiet" onClick={() => setAddressBookDialog('')} type="button">Cancel</button><button className="button button-primary" disabled={addressBookBusy} type="submit">{addressBookBusy ? 'Saving…' : 'Save address'}</button></div>
              </form>
            ) : (
              <>
                {managedAddressEntries.length === 0
                  ? <p className="muted">No saved {managedAddressPurpose} addresses yet.</p>
                  : <ul className="address-book-list">{managedAddressEntries.map((entry) => (
                    <li className="address-book-item" key={entry.id}>
                      <div><strong>{entry.label}</strong><span>{entry.ticker.toUpperCase()} · {entry.network.toUpperCase()}</span><code>{entry.address}</code>{entry.extraId && <small>Previously saved memo or tag (not applied): {entry.extraId}</small>}</div>
                      <button className="button button-quiet" disabled={addressBookBusy} onClick={() => removeAddress(entry)} type="button">Remove</button>
                    </li>
                  ))}</ul>}
                <div className="form-actions"><button className="button button-quiet" onClick={() => setAddressBookDialog('')} type="button">Close</button></div>
              </>
            )}
          </section>
        </div>
      )}

      {confirming && selectedPreset && quote?.quoteId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(false) }}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">FINAL REVIEW</p>
            <h2 id="confirm-title">Confirm This Route?</h2>
            <p className="muted">Review the route and live estimate before creating a deposit tunnel.</p>
            <div className={`quote-expiry ${quoteExpired ? 'quote-expiry-expired' : ''}`} role="timer" aria-label={quoteExpired ? 'Quote expired' : `Quote expires in ${formatTunnelTimeRemaining(quote.quoteExpiresAt, clockNow)}`}>
              <span>Live quote</span><strong>{quoteExpired ? 'Expired' : `Expires in ${formatTunnelTimeRemaining(quote.quoteExpiresAt, clockNow)}`}</strong>
              <small>Until {new Date(quote.quoteExpiresAt).toLocaleTimeString()}</small>
            </div>
            <dl className="confirmation-list">
              <div><dt>Send</dt><dd>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()} on {selectedPreset.fromNetwork?.toUpperCase()}</dd></div>
              <div><dt>Receive</dt><dd>{selectedPreset.toCurrency?.toUpperCase()} on {selectedPreset.toNetwork?.toUpperCase()}</dd></div>
              <div><dt>Estimated receive</dt><dd>{quote.estimatedAmount} {selectedPreset.toCurrency?.toUpperCase()}</dd></div>
              {estimatedRate && <div><dt>Estimated rate</dt><dd><code>{estimatedRate}</code><br />Based on this quote and send amount; not a fixed rate.</dd></div>}
              <div><dt>Minimum send</dt><dd>{quote.minimumAmount} {selectedPreset.fromCurrency?.toUpperCase()}</dd></div>
              <div><dt>Destination</dt><dd>{getDestinationWalletName(selectedPreset)} on {selectedPreset.toNetwork?.toUpperCase()}<br /><code>{selectedPreset.destinationAddress}</code></dd></div>
              {swapDestinationExtraId && <div><dt>Memo or tag</dt><dd><code>{swapDestinationExtraId}</code></dd></div>}
              {selectedPreset.refundAddress && <div><dt>Refund address</dt><dd>On {selectedPreset.fromNetwork?.toUpperCase()}<br /><code>{selectedPreset.refundAddress}</code></dd></div>}
              {swapRefundExtraId && <div><dt>Refund memo or tag</dt><dd><code>{swapRefundExtraId}</code></dd></div>}
            </dl>
            {quote.warningMessage && <p className="modal-warning">{quote.warningMessage}</p>}
            {waitingTunnelCount >= MAX_WAITING_TUNNELS && <p className="modal-warning">All 3 waiting-for-deposit slots are in use. Wait for a deposit or close a waiting tunnel before opening another.</p>}
            <p className="modal-warning">This estimate is indicative and may change. Confirming creates a ChangeNOW exchange and deposit address; it does not send funds. You must send the exact asset over the exact network shown in the deposit instructions.</p>
            {quoteExpired && <p className="notice notice-warning" role="alert">This quote has expired. Go back and request a fresh quote before creating the tunnel.</p>}
            <div className="form-actions"><button className="button button-quiet" onClick={() => setConfirming(false)} type="button">Go back</button><button className="button button-primary" disabled={busy || quoteExpired || waitingTunnelCount >= MAX_WAITING_TUNNELS} onClick={confirmSwap} type="button">{busy ? 'Creating tunnel…' : quoteExpired ? 'Quote expired' : 'Confirm & create tunnel'}</button></div>
          </section>
        </div>
      )}
      {copyToast && <div className={`copy-toast ${copyToast.error ? 'copy-toast-error' : ''}`} role="status" aria-live="polite">{copyToast.message}</div>}
    </div>
  )
}