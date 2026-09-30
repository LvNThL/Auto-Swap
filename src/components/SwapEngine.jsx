import { useEffect, useState } from 'react'
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
  sourceName: '',
  fromCurrency: 'btc',
  fromNetwork: 'btc',
  toCurrency: 'eth',
  toNetwork: 'eth',
  fromAmount: '',
  destinationName: '',
  destinationAddress: '',
  destinationExtraId: '',
  refundAddress: '',
  refundExtraId: '',
}

const TUNNEL_ACCESS_TTL_MS = 7 * 60 * 1000

function currencyGroups(currencies) {
  const featured = currencies.filter((currency) => currency.featured)
  const other = currencies.filter((currency) => !currency.featured)
  return [
    ...(featured.length ? [{ label: 'Popular', options: featured }] : []),
    ...(other.length ? [{ label: 'More supported assets', options: other }] : []),
  ]
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
      <span>{currency.name}</span>
      <small>{currency.ticker.toUpperCase()} · {currency.network.toUpperCase()}</small>
    </div>
  )
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

  return currencies.filter((currency) =>
    `${currency.name} ${currency.ticker} ${currency.network}`.toLowerCase().includes(normalizedQuery))
}

function getSourceWalletName(preset) {
  return preset.sourceName?.trim() || 'Source Wallet'
}

function getDestinationWalletName(preset) {
  if (typeof preset.sourceName === 'undefined') return 'Destination Wallet'
  return preset.destinationName?.trim() || 'Destination Wallet'
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

const terminalSwapStatuses = new Set(['finished', 'failed', 'refunded', 'expired', 'cancelled'])
const depositReceivedStatuses = new Set(['confirming', 'exchanging', 'sending', 'finished', 'failed', 'refunded'])
const MAX_WAITING_TUNNELS = 3
const autoSwapClosureReasons = new Set(['user-requested', 'access-window-ended'])

function isLocallyClosedSwap(swap) {
  return String(swap.status || '').toLowerCase() === 'cancelled'
    && autoSwapClosureReasons.has(swap.cancellationReason)
}

function SwapHistoryItem({ swap, onCancel, cancellingExchangeId, statusCheck }) {
  const status = String(swap.status || 'unknown').toLowerCase()
  const isTerminal = terminalSwapStatuses.has(status)
  const accessExpiresAt = swap.accessExpiresAt ?? (swap.createdAt ? swap.createdAt + TUNNEL_ACCESS_TTL_MS : null)
  const canCancel = swap.pending
    && status === 'waiting'
    && Number.isFinite(accessExpiresAt)
    && Date.now() >= accessExpiresAt
    && statusCheck?.status === 'waiting'
    && statusCheck.requestStartedAt >= accessExpiresAt

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
        {canCancel && (
          <button className="button button-quiet" disabled={cancellingExchangeId !== ''} onClick={() => onCancel(swap)} title="Closes tracking in AutoSwap only; this does not cancel the ChangeNOW exchange." type="button">
            {cancellingExchangeId === swap.exchangeId ? 'Checking…' : 'Cancel'}
          </button>
        )}
      </div>
    </article>
  )
}

export default function SwapEngine({ user, themePreference, onThemeChange, installPrompt, isInstalled, isIos, onInstallPromptConsumed }) {
  const [presets, setPresets] = useState([])
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
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState(emptyPreset)
  const [showNewPreset, setShowNewPreset] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [tunnelNotice, setTunnelNotice] = useState('')
  const [error, setError] = useState('')
  const [quote, setQuote] = useState(null)
  const [tunnel, setTunnel] = useState(null)
  const [tunnelPreset, setTunnelPreset] = useState(null)
  const [swapHistory, setSwapHistory] = useState([])
  const [pendingSwaps, setPendingSwaps] = useState([])
  const [historyArchives, setHistoryArchives] = useState([])
  const [archiveError, setArchiveError] = useState('')
  const [archiveDownloadBusy, setArchiveDownloadBusy] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [cancellingExchangeId, setCancellingExchangeId] = useState('')
  const [statusCheckByExchange, setStatusCheckByExchange] = useState({})
  const [copyToast, setCopyToast] = useState(null)
  const [clockNow, setClockNow] = useState(() => Date.now())

  const selectedPreset = presets.find((preset) => preset.id === selectedId)
  const waitingTunnelCount = pendingSwaps.filter((swap) => String(swap.status || 'waiting').toLowerCase() === 'waiting').length
  const openTunnels = pendingSwaps
    .map((swap) => ({
      ...swap,
      id: swap.exchangeId ?? swap.id,
      accessExpiresAt: swap.accessExpiresAt ?? (swap.createdAt ? swap.createdAt + TUNNEL_ACCESS_TTL_MS : 0),
    }))
    .filter((swap) => swap.payinAddress && clockNow < swap.accessExpiresAt)
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  const openTunnelIds = new Set(openTunnels.map((swap) => swap.id))
  if (tunnel?.payinAddress && clockNow < tunnel.accessExpiresAt && !openTunnelIds.has(tunnel.id)) {
    openTunnels.unshift({
      ...tunnel,
      sourceName: tunnelPreset?.sourceName,
      fromCurrency: tunnelPreset?.fromCurrency,
      fromNetwork: tunnelPreset?.fromNetwork,
      fromAmount: tunnelPreset?.fromAmount,
      toCurrency: tunnelPreset?.toCurrency,
      toNetwork: tunnelPreset?.toNetwork,
      createdAt: tunnel.accessExpiresAt - TUNNEL_ACCESS_TTL_MS,
    })
  }
  const openTunnelTimerKey = openTunnels.map((swap) => swap.id).join('|')
  const visibleSwapHistory = [
    ...swapHistory.filter((swap) => {
      const status = String(swap.status || '').toLowerCase()
      return depositReceivedStatuses.has(status) || terminalSwapStatuses.has(status)
    }),
    ...pendingSwaps.map((swap) => ({
      ...swap,
      id: swap.id ?? swap.exchangeId,
      toAmount: swap.estimatedAmount ?? null,
      status: swap.status || 'waiting',
      pending: true,
    })),
  ].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  const waitingSwapRows = visibleSwapHistory.filter((swap) =>
    swap.pending && String(swap.status || '').toLowerCase() === 'waiting')
  const olderWaitingSwaps = waitingSwapRows.slice(1)
  const olderWaitingIds = new Set(olderWaitingSwaps.map((swap) => swap.id))
  const recentSwapHistory = visibleSwapHistory.filter((swap) => !olderWaitingIds.has(swap.id))
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
  const destinationAddressEntries = addressBookEntries.filter((entry) =>
    entry.purpose === 'destination' && entry.ticker === selectedToCurrency?.ticker && entry.network === selectedToCurrency?.network)
  const refundAddressEntries = addressBookEntries.filter((entry) =>
    entry.purpose === 'refund' && entry.ticker === selectedFromCurrency?.ticker && entry.network === selectedFromCurrency?.network)

  async function loadSwapHistory() {
    const getHistory = httpsCallable(functions, 'getSwapHistory')
    const { data } = await getHistory({})
    setSwapHistory(data.swaps ?? [])
    setPendingSwaps(data.pendingSwaps ?? [])
  }

  async function closeWaitingSwap(swap) {
    const confirmed = window.confirm(
      `Cancel tracking for ${swap.fromAmount} ${swap.fromCurrency?.toUpperCase()}?\n\nOnly continue if you did not send funds. AutoSwap checks with ChangeNOW first, then closes this log locally. It does not cancel the ChangeNOW exchange or deactivate its deposit address.`,
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
    const getArchives = httpsCallable(functions, 'getSwapHistoryArchives')
    const { data } = await getArchives({})
    setHistoryArchives(data.archives ?? [])
    setArchiveError('')
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
      setArchiveError('This monthly archive could not be downloaded. Please try again.')
    } finally {
      setArchiveDownloadBusy('')
    }
  }

  async function copyToClipboard(value, label, target) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyToast({ message: `${label} copied`, target })
    } catch {
      setCopyToast({ message: 'Clipboard access is unavailable', target: '' })
    }
  }

  useEffect(() => {
    if (!copyToast) return undefined
    const timeout = window.setTimeout(() => setCopyToast(null), 2200)
    return () => window.clearTimeout(timeout)
  }, [copyToast])

  useEffect(() => {
    if (openTunnels.length === 0) return undefined
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [openTunnelTimerKey])

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
      } catch {
        if (active) setHistoryError("We couldn't load exchange activity just now. This doesn't mean your swap failed. Please refresh in a moment.")
      } finally {
        if (active) setHistoryLoading(false)
      }
    }

    async function pollHistory() {
      if (polling) return
      polling = true
      try {
        const { data } = await getHistory({})
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

    loadHistory()
    loadHistoryArchives().catch(() => {
      if (active) setArchiveError('Monthly archives could not be loaded. Your current swap history is unaffected.')
    })
    const interval = window.setInterval(pollHistory, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [user.uid])

  async function refreshPresets() {
    const saved = await listPresets(user.uid)
    setPresets(saved)
    if (!saved.some((preset) => preset.id === selectedId)) setSelectedId(saved[0]?.id ?? '')
  }

  useEffect(() => {
    let active = true
    setCurrenciesLoading(true)
    setCurrencyError('')
    setAddressBookError('')
    refreshPresets().catch(() => setError('Saved routes could not be loaded. Check your Firebase setup.'))
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
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'toCurrency' || name === 'toNetwork' ? { destinationExtraId: '' } : {}),
    }))
  }

  function updateSelectedCurrency(side, currency) {
    if (!currency) return

    setForm((current) => ({
      ...current,
      [`${side}Currency`]: currency.ticker,
      [`${side}Network`]: currency.network,
      ...(side === 'to' ? { destinationExtraId: '' } : {}),
      ...(side === 'from' ? { refundExtraId: '' } : {}),
    }))
    if (side === 'from') setFromSearch('')
    if (side === 'to') setToSearch('')
  }

  function loadAddress(target, entryId) {
    const entry = addressBookEntries.find((savedEntry) => savedEntry.id === entryId)
    if (!entry) return
    setForm((current) => ({
      ...current,
      ...(target === 'destination'
        ? { destinationAddress: entry.address, destinationExtraId: entry.extraId ?? '' }
        : { refundAddress: entry.address, refundExtraId: entry.extraId ?? '' }),
    }))
  }

  function beginSaveAddress(purpose) {
    const currency = purpose === 'destination' ? selectedToCurrency : selectedFromCurrency
    const address = purpose === 'destination' ? form.destinationAddress : form.refundAddress
    const extraId = purpose === 'destination' ? form.destinationExtraId : form.refundExtraId
    if (!currency || !address.trim()) {
      setError('Enter an address before saving it to your address book.')
      return
    }
    setAddressDraft({ label: '', address: address.trim(), extraId: extraId.trim(), ticker: currency.ticker, network: currency.network, purpose })
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
        extraId: addressDraft.extraId.trim(),
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
      sourceName: selectedPreset.sourceName ?? '',
      fromCurrency: selectedPreset.fromCurrency ?? emptyPreset.fromCurrency,
      fromNetwork: selectedPreset.fromNetwork ?? emptyPreset.fromNetwork,
      toCurrency: selectedPreset.toCurrency ?? emptyPreset.toCurrency,
      toNetwork: selectedPreset.toNetwork ?? emptyPreset.toNetwork,
      fromAmount: selectedPreset.fromAmount ?? '',
      destinationName: typeof selectedPreset.sourceName === 'undefined'
        ? ''
        : selectedPreset.destinationName ?? '',
      destinationAddress: selectedPreset.destinationAddress ?? '',
      destinationExtraId: selectedPreset.destinationExtraId ?? '',
      refundAddress: selectedPreset.refundAddress ?? '',
      refundExtraId: selectedPreset.refundExtraId ?? '',
    })
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
    setEditingPresetId('')
    setForm(emptyPreset)
    setFromSearch('')
    setToSearch('')
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
    setError('')
    setNotice('')
    setHistoryError('')
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
        sourceName: form.sourceName.trim(),
        destinationName: form.destinationName.trim(),
        destinationAddress: form.destinationAddress.trim(),
        fromAmount: form.fromAmount.trim(),
        destinationExtraId: form.destinationExtraId.trim(),
        refundAddress: form.refundAddress.trim(),
        refundExtraId: form.refundExtraId.trim(),
      }
      let savedPresetId = editingPresetId
      if (savedPresetId) {
        await updatePreset(user.uid, savedPresetId, preset)
      } else {
        savedPresetId = await createPreset(user.uid, preset)
      }
      await refreshPresets()
      if (savedPresetId) setSelectedId(savedPresetId)
      setQuote(null)
      setConfirming(false)
      setNotice('')
      setShowNewPreset(false)
      setEditingPresetId('')
      setForm(emptyPreset)
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
      toExtraId: preset.destinationExtraId,
      refundAddress: preset.refundAddress,
      refundExtraId: preset.refundExtraId,
      quoteId,
      presetId: preset.id,
    })
    return result.data
  }

  async function requestQuote() {
    if (!selectedPreset) return
    setBusy(true)
    setError('')
    setNotice('Checking current pair availability and a live estimate with ChangeNOW…')
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
        toExtraId: selectedPreset.destinationExtraId,
        refundAddress: selectedPreset.refundAddress,
        refundExtraId: selectedPreset.refundExtraId,
        presetId: selectedPreset.id,
      })
      setQuote(result.data)
      setConfirming(true)
      setNotice('')
    } catch (quoteError) {
      setError(`ChangeNOW could not provide a usable live quote, so no deposit address was created. Do not send funds. ${getErrorMessage(quoteError)}`)
      setNotice('')
    } finally {
      setBusy(false)
    }
  }

  async function confirmSwap() {
    if (!selectedPreset || !quote?.quoteId) return
    if (waitingTunnelCount >= MAX_WAITING_TUNNELS) {
      setError('This account already has 3 tunnels waiting for a deposit. Wait for a deposit or close a waiting tunnel before opening another.')
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
    setTunnelNotice('')

    try {
      const created = await createTunnel(selectedPreset, quote.quoteId)
      if (!created.payinAddress) throw new Error('ChangeNOW did not return a deposit address. The exchange may not support this route.')
      const tunnelAccessExpiresAt = created.accessExpiresAt ?? Date.now() + TUNNEL_ACCESS_TTL_MS
      setTunnel({ ...created, presetId: selectedPreset.id, accessExpiresAt: tunnelAccessExpiresAt })
      setTunnelPreset(selectedPreset)
      setQuote(null)
      setHistoryError(created.trackingSaved ? '' : 'Automatic tracking for this exchange could not be saved. It may not appear in history automatically. Keep the exchange ID in its deposit details, if available, to check its status with ChangeNOW.')
      if (created.trackingSaved && created.id) {
        setPendingSwaps((current) => [{
          id: created.id,
          exchangeId: created.id,
          presetId: selectedPreset.id,
          accessExpiresAt: tunnelAccessExpiresAt,
          status: created.status || 'waiting',
          payinAddress: created.payinAddress,
          payinExtraId: created.payinExtraId,
          sourceName: selectedPreset.sourceName,
          fromCurrency: selectedPreset.fromCurrency,
          fromNetwork: selectedPreset.fromNetwork,
          fromAmount: selectedPreset.fromAmount,
          toCurrency: selectedPreset.toCurrency,
          toNetwork: selectedPreset.toNetwork,
          estimatedAmount: quote.estimatedAmount,
          createdAt: tunnelAccessExpiresAt - TUNNEL_ACCESS_TTL_MS,
        }, ...current.filter((swap) => swap.exchangeId !== created.id)])
        loadSwapHistory().catch(() => setHistoryError("We couldn't refresh tracking details for this exchange. Please refresh exchange activity shortly."))
      }

      const sourceWallet = getSourceWalletName(selectedPreset)
      setNotice('')
      setTunnelNotice(`Send only ${selectedPreset.fromCurrency?.toUpperCase()} on ${selectedPreset.fromNetwork?.toUpperCase()} from ${sourceWallet} to this address. This deposit address is for this exchange only.`)
    } catch (swapError) {
      setError(`ChangeNOW did not create a usable deposit tunnel. No deposit address is available; do not send funds. ${getErrorMessage(swapError)}`)
      setNotice('')
      setQuote(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="app-brand" href="./" aria-label="AutoSwap Route Desk home">
          <BrandMark />
          <span className="brand-copy"><strong>AutoSwap</strong><small>Route Desk</small></span>
        </a>
        <AccountTools installPrompt={installPrompt} isInstalled={isInstalled} isIos={isIos} onInstallPromptConsumed={onInstallPromptConsumed} onThemeChange={onThemeChange} themePreference={themePreference} user={user} />
      </header>

      <main className="workspace">
        <aside className="route-rail">
          <div className="rail-heading">
            <div><p className="eyebrow">YOUR WORKSPACE</p><h2>Saved Routes</h2></div>
            <button className="icon-button" aria-label="Create route" title="Create route" onClick={toggleNewPreset} type="button">+</button>
          </div>
          {presets.length === 0 && <p className="empty-routes">No routes saved yet.</p>}
          <nav className="route-list" aria-label="Saved routes">
            {presets.map((preset) => (
              <button
                className={`route-item ${selectedId === preset.id ? 'route-item-active' : ''}`}
                key={preset.id}
                onClick={() => {
                  setSelectedId(preset.id)
                  setShowNewPreset(false)
                  setEditingPresetId('')
                  setForm(emptyPreset)
                  setQuote(null)
                  setTunnel(null)
                  setTunnelPreset(null)
                  setTunnelNotice('')
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
            <div><p className="eyebrow">POWERED BY CHANGENOW</p><h1>Route Desk</h1></div>
            {selectedPreset && !showNewPreset && <button className="button button-quiet delete-button" onClick={removePreset} type="button">Delete route</button>}
          </div>

          {!isFirebaseConfigured && <div className="notice notice-warning">Firebase is not configured. Add the VITE_FIREBASE_* values before signing in or saving routes.</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {addressBookError && <div className="notice notice-error" role="alert">{addressBookError}</div>}

          {showNewPreset && (
            <section className="panel new-route-panel">
              <div className="panel-heading"><div><p className="eyebrow">{editingPresetId ? 'EDIT PRESET' : 'NEW PRESET'}</p><h2>{editingPresetId ? 'Edit Saved Route' : 'Route Details'}</h2></div></div>
              <form className="preset-form" onSubmit={savePreset}>
                <label className="field-wide">Source wallet or app (optional)<input name="sourceName" value={form.sourceName} onChange={updateForm} placeholder="For your reference" maxLength="48" /></label>
                {currenciesLoading && <p className="field-note field-wide" role="status">Loading ChangeNOW assets…</p>}
                {currencyError && <div className="notice notice-error field-wide" role="alert">{currencyError}<button className="button button-quiet" onClick={() => setCurrencyReloadKey((key) => key + 1)} type="button">Reload assets</button></div>}
                <label className="field-wide">Send crypto from
                  <Select
                    aria-label="Send crypto from"
                    className="asset-select"
                    classNamePrefix="asset-select"
                    inputId="send-asset-select"
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
                    options={currencyGroups(matchingFromCurrencies)}
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
                    options={currencyGroups(matchingToCurrencies)}
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
                  <p>After the quote is confirmed, send the selected asset on its selected network from any compatible wallet to the ChangeNOW deposit address. The exchanged asset will be sent to your destination address.</p>
                </div>
                <label>Amount to send ({form.fromCurrency.toUpperCase()})<input aria-describedby="minimum-send-note" name="fromAmount" inputMode="decimal" value={form.fromAmount} onChange={updateForm} placeholder="0.05" required /></label>
                <p className="field-note field-wide" id="minimum-send-note" role="status">
                  {minimumStatus === 'loading' && 'Checking the minimum for this pair… '}
                  {minimumStatus === 'ready' && `Minimum send for the selected pair: ${minimumAmount} ${form.fromCurrency.toUpperCase()}. `}
                  {minimumStatus === 'error' && 'The current minimum is unavailable. ChangeNOW will check it when you request a quote. '}
                  Enter the amount you plan to send to ChangeNOW. The estimated receive amount appears after you request a quote.
                </p>
                <label className="field-wide">Destination wallet or app (optional)<input name="destinationName" value={form.destinationName} onChange={updateForm} placeholder="For your reference" maxLength="48" /></label>
                <label className="field-wide">Destination address<input name="destinationAddress" value={form.destinationAddress} onChange={updateForm} autoComplete="off" placeholder="Address on the selected receive network" required /></label>
                {selectedToCurrency?.hasExternalId && <label className="field-wide">Destination memo or tag<input name="destinationExtraId" value={form.destinationExtraId} onChange={updateForm} autoComplete="off" placeholder="Required by this asset" required /></label>}
                <div className="address-tools field-wide">
                  <select aria-label="Load a saved destination address" value="" onChange={(event) => loadAddress('destination', event.target.value)}>
                    <option value="">Load a saved destination address…</option>
                    {destinationAddressEntries.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
                  </select>
                  <button className="button button-quiet" onClick={() => beginSaveAddress('destination')} type="button">Save destination address</button>
                  <button className="button button-quiet" onClick={() => setAddressBookDialog('manage')} type="button">Manage address book</button>
                </div>
                <label className="field-wide">Refund address <span className="optional-label">Optional. Used only if the exchange refunds the swap.</span><input name="refundAddress" value={form.refundAddress} onChange={updateForm} autoComplete="off" placeholder="Crypto address on the send network" /></label>
                {selectedFromCurrency?.hasExternalId && <label className="field-wide">Refund memo or tag<input name="refundExtraId" value={form.refundExtraId} onChange={updateForm} autoComplete="off" placeholder="Optional refund memo or tag" /></label>}
                <div className="address-tools field-wide">
                  <select aria-label="Load a saved refund address" value="" onChange={(event) => loadAddress('refund', event.target.value)}>
                    <option value="">Load a saved refund address…</option>
                    {refundAddressEntries.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
                  </select>
                  <button className="button button-quiet" onClick={() => beginSaveAddress('refund')} type="button">Save refund address</button>
                </div>
                <p className="field-note field-wide">Use a wallet that can send the selected asset on the selected network. Only pairs supported by ChangeNOW can be quoted; verify the live quote before creating a deposit tunnel.</p>
                <div className="form-actions field-wide"><button className="button button-quiet" disabled={busy} onClick={cancelPresetForm} type="button">Cancel</button><button className="button button-primary" disabled={busy || currenciesLoading || !selectedFromCurrency?.canSell || !selectedToCurrency?.canBuy} type="submit">{busy ? 'Saving…' : editingPresetId ? 'Save changes' : 'Save preset'}</button></div>
              </form>
            </section>
          )}

          {!selectedPreset && !showNewPreset && (
            <section className="empty-state"><div className="empty-glyph" aria-hidden="true">↗</div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Create Your First Route</h2><p>Save your swap details and destination addresses for easy reuse.</p><button className="button button-primary" onClick={toggleNewPreset} type="button">Create a route <span aria-hidden="true">+</span></button></section>
          )}

          {selectedPreset && !showNewPreset && (
            <>
              <section className="route-summary">
                <div className="summary-origin"><span className="summary-label">FROM</span><strong>{getSourceWalletName(selectedPreset)}</strong></div>
                <div className="summary-destination"><span className="summary-label">TO</span><strong>{getDestinationWalletName(selectedPreset)}</strong></div>
              </section>
              <section className="panel active-route-panel">
                <div className="panel-heading"><div><p className="eyebrow">ACTIVE PRESET</p><h2>{getPresetName(selectedPreset)}</h2></div><span className="panel-index">01 / ROUTE</span></div>
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
              <p className="field-note">Each address is shown for its own seven-minute window, across all routes. When a window ends, the address is removed from this panel; the timer does not deactivate it with ChangeNOW.</p>
              {tunnelNotice && <div className="notice notice-success" role="status">{tunnelNotice}</div>}
              <div className="open-tunnel-list">
                {openTunnels.map((openTunnel) => {
                  const route = `${openTunnel.fromCurrency?.toUpperCase()} (${openTunnel.fromNetwork?.toUpperCase()}) to ${openTunnel.toCurrency?.toUpperCase()} (${openTunnel.toNetwork?.toUpperCase()})`
                  const addressTarget = `address-${openTunnel.id}`
                  const memoTarget = `memo-${openTunnel.id}`
                  return (
                    <article className="open-tunnel-item" key={openTunnel.id ?? openTunnel.payinAddress}>
                      <div className="open-tunnel-heading"><div><strong>{route}</strong><small>{getSourceWalletName(openTunnel)}{openTunnel.fromAmount ? ` · ${openTunnel.fromAmount} ${openTunnel.fromCurrency?.toUpperCase()}` : ''}</small></div><span className="live-badge">{formatTunnelTimeRemaining(openTunnel.accessExpiresAt, clockNow)}</span></div>
                      <p className="field-note">Send only {openTunnel.fromCurrency?.toUpperCase()} on {openTunnel.fromNetwork?.toUpperCase()} from {getSourceWalletName(openTunnel)}. Sending another asset or network can permanently lose funds.</p>
                      <div className="notice notice-warning single-use-warning">Use this address once for this exchange only. Never reuse it for another quote or swap.</div>
                      <div className="deposit-address"><span>Deposit address</span><code>{openTunnel.payinAddress}</code><button aria-label={copyToast?.target === addressTarget ? 'Address copied to clipboard' : 'Copy address'} aria-live="polite" className={`button button-quiet ${copyToast?.target === addressTarget ? 'button-copy-confirmed' : ''}`} onClick={() => copyToClipboard(openTunnel.payinAddress, 'Address', addressTarget)} type="button">{copyToast?.target === addressTarget ? '✓ Copied' : 'Copy address'}</button></div>
                      {openTunnel.payinExtraId && <div className="deposit-address"><span>Required deposit memo or tag</span><code>{openTunnel.payinExtraId}</code><button aria-label={copyToast?.target === memoTarget ? 'Memo or tag copied to clipboard' : 'Copy memo or tag'} aria-live="polite" className={`button button-quiet ${copyToast?.target === memoTarget ? 'button-copy-confirmed' : ''}`} onClick={() => copyToClipboard(openTunnel.payinExtraId, 'Memo or tag', memoTarget)} type="button">{copyToast?.target === memoTarget ? '✓ Copied' : 'Copy memo or tag'}</button></div>}
                      {(openTunnel.transactionHash || openTunnel.payinHash) && <div className="transaction-hash"><span>Wallet transaction</span><code>{openTunnel.transactionHash ?? openTunnel.payinHash}</code></div>}
                      {openTunnel.id && <p className="field-note">Exchange ID: {openTunnel.id}</p>}
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          <section className="panel history-panel" aria-labelledby="swap-history-title">
            <div className="panel-heading"><div><p className="eyebrow">EXCHANGE ACTIVITY</p><h2 id="swap-history-title">Swap History</h2></div></div>
            {historyError && !showNewPreset && <div className="notice notice-warning" role="status">{historyError}</div>}
            {historyLoading ? <p className="history-empty">Loading exchange activity…</p> : visibleSwapHistory.length === 0 ? <p className="history-empty">Swaps appear here as Waiting when a deposit tunnel opens. If a tunnel expires before a deposit is received, it is marked Cancelled. Once a deposit is detected, the swap remains in history through processing and completion.</p> : (
              <>
                <div className="history-list">
                  {recentSwapHistory.map((swap) => (
                    <SwapHistoryItem key={swap.id} cancellingExchangeId={cancellingExchangeId} onCancel={closeWaitingSwap} statusCheck={statusCheckByExchange[swap.exchangeId]} swap={swap} />
                  ))}
                </div>
                {olderWaitingSwaps.length > 0 && (
                  <details className="history-older-waiting">
                    <summary>Older waiting tunnels ({olderWaitingSwaps.length})</summary>
                    <div className="history-list">
                      {olderWaitingSwaps.map((swap) => (
                        <SwapHistoryItem key={swap.id} cancellingExchangeId={cancellingExchangeId} onCancel={closeWaitingSwap} statusCheck={statusCheckByExchange[swap.exchangeId]} swap={swap} />
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
            <div className="history-archives">
              <div className="history-archives-heading">
                <div><strong>Monthly Tax Archives</strong><small>Completed executions are retained for download.</small></div>
                <button className="button button-quiet" disabled={historyLoading} onClick={() => loadHistoryArchives().catch(() => setArchiveError('Monthly archives could not be loaded. Please try again.'))} type="button">Refresh</button>
              </div>
              {archiveError && <div className="notice notice-warning" role="status">{archiveError}</div>}
              {historyArchives.length === 0
                ? !archiveError && <p className="history-empty">Monthly archives will appear here after the first archive run.</p>
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
            <h2 id="address-book-title">{addressBookDialog === 'save' ? 'Save Address' : 'Address Book'}</h2>
            {addressBookDialog === 'save' ? (
              <form className="address-save-form" onSubmit={saveAddress}>
                <p className="muted">{addressDraft.ticker.toUpperCase()} on {addressDraft.network.toUpperCase()} · {addressDraft.purpose === 'destination' ? 'Destination' : 'Refund'} address</p>
                <label>Address label<input autoFocus maxLength="48" onChange={(event) => setAddressDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="For example, Main wallet" required value={addressDraft.label} /></label>
                <div className="address-preview"><code>{addressDraft.address}</code>{addressDraft.extraId && <small>Memo or tag: {addressDraft.extraId}</small>}</div>
                <div className="form-actions"><button className="button button-quiet" onClick={() => setAddressBookDialog('')} type="button">Cancel</button><button className="button button-primary" disabled={addressBookBusy} type="submit">{addressBookBusy ? 'Saving…' : 'Save address'}</button></div>
              </form>
            ) : (
              <>
                {addressBookEntries.length === 0
                  ? <p className="muted">No saved addresses yet.</p>
                  : <ul className="address-book-list">{addressBookEntries.map((entry) => (
                    <li className="address-book-item" key={entry.id}>
                      <div><strong>{entry.label}</strong><span>{entry.ticker.toUpperCase()} · {entry.network.toUpperCase()} · {entry.purpose}</span><code>{entry.address}</code>{entry.extraId && <small>Memo or tag: {entry.extraId}</small>}</div>
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
            <p className="muted">Review the live estimate before creating a deposit tunnel. This quote expires at {new Date(quote.quoteExpiresAt).toLocaleTimeString()}.</p>
            <dl className="confirmation-list">
              <div><dt>Send</dt><dd>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()} on {selectedPreset.fromNetwork?.toUpperCase()}</dd></div>
              <div><dt>Receive</dt><dd>{selectedPreset.toCurrency?.toUpperCase()} on {selectedPreset.toNetwork?.toUpperCase()}</dd></div>
              <div><dt>Estimated receive</dt><dd>{quote.estimatedAmount} {selectedPreset.toCurrency?.toUpperCase()}</dd></div>
              {estimatedRate && <div><dt>Estimated rate</dt><dd><code>{estimatedRate}</code><br />Based on this quote and send amount; not a fixed rate.</dd></div>}
              <div><dt>Minimum send</dt><dd>{quote.minimumAmount} {selectedPreset.fromCurrency?.toUpperCase()}</dd></div>
              <div><dt>Destination</dt><dd>{getDestinationWalletName(selectedPreset)}<br /><code>{selectedPreset.destinationAddress}</code></dd></div>
              {selectedPreset.destinationExtraId && <div><dt>Memo or tag</dt><dd><code>{selectedPreset.destinationExtraId}</code></dd></div>}
              {selectedPreset.refundAddress && <div><dt>Refund address</dt><dd><code>{selectedPreset.refundAddress}</code></dd></div>}
              {selectedPreset.refundExtraId && <div><dt>Refund memo or tag</dt><dd><code>{selectedPreset.refundExtraId}</code></dd></div>}
            </dl>
            {quote.warningMessage && <p className="modal-warning">{quote.warningMessage}</p>}
            {waitingTunnelCount >= MAX_WAITING_TUNNELS && <p className="modal-warning">All 3 waiting-for-deposit slots are in use. Wait for a deposit or close a waiting tunnel before opening another.</p>}
            <p className="modal-warning">This standard-flow estimate is indicative and may change. Confirming creates the exchange. Your wallet will ask for separate approval before sending funds.</p>
            <div className="form-actions"><button className="button button-quiet" onClick={() => setConfirming(false)} type="button">Go back</button><button className="button button-primary" disabled={busy || waitingTunnelCount >= MAX_WAITING_TUNNELS} onClick={confirmSwap} type="button">{busy ? 'Creating tunnel…' : 'Confirm & create tunnel'}</button></div>
          </section>
        </div>
      )}
      {copyToast && <div className="copy-toast" role="status" aria-live="polite">{copyToast.message}</div>}
    </div>
  )
}