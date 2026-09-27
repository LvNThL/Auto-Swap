import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { signOut } from 'firebase/auth'
import Select from 'react-select'
import { auth, functions, isFirebaseConfigured } from '../firebase.js'
import {
  createAddressBookEntry,
  deleteAddressBookEntry,
  listAddressBookEntries,
} from '../services/AddressBookManager.js'
import { createPreset, deletePreset, listPresets, updatePreset } from '../services/PresetManager.js'

const emptyPreset = {
  name: '',
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
    borderColor: state.isFocused ? '#739a32' : '#dbe1d8',
    borderRadius: 5,
    boxShadow: 'none',
    fontSize: 12,
    ':hover': { borderColor: '#a6b49e' },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 30 }),
  menu: (base) => ({ ...base, zIndex: 30, overflow: 'hidden', border: '1px solid #dbe1d8', borderRadius: 6 }),
  menuList: (base) => ({ ...base, maxHeight: 260, overflowY: 'auto', scrollbarWidth: 'thin' }),
  groupHeading: (base) => ({ ...base, color: '#718078', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, textTransform: 'uppercase' }),
  option: (base, state) => ({
    ...base,
    padding: '8px 11px',
    backgroundColor: state.isSelected ? '#e9f4d9' : state.isFocused ? '#f3f7ed' : '#fff',
    color: '#202923',
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
  if (!normalizedQuery) {
    const featured = currencies.filter((currency) => currency.featured)
    return featured.length ? featured : currencies.slice(0, 20)
  }

  return currencies.filter((currency) =>
    `${currency.name} ${currency.ticker} ${currency.network}`.toLowerCase().includes(normalizedQuery))
}

function getSourceWalletName(preset) {
  return preset.sourceName?.trim() || 'Source wallet'
}

function getDestinationWalletName(preset) {
  if (typeof preset.sourceName === 'undefined') return 'Destination wallet'
  return preset.destinationName?.trim() || 'Destination wallet'
}

function getErrorMessage(error) {
  if (error?.code === 'functions/permission-denied') return 'Sign in again before creating a swap.'
  if (error?.code === 'functions/invalid-argument') return error.message
  return error?.message || 'The route could not be completed. Check the route and try again.'
}

export default function SwapEngine({ user }) {
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
  const [error, setError] = useState('')
  const [quote, setQuote] = useState(null)
  const [tunnel, setTunnel] = useState(null)
  const [tunnelPreset, setTunnelPreset] = useState(null)

  const selectedPreset = presets.find((preset) => preset.id === selectedId)
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
    } catch {
      setAddressBookError('Address could not be saved. Check your connection and Firestore rules.')
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
    } catch {
      setAddressBookError('Address could not be removed. Check your connection and try again.')
    } finally {
      setAddressBookBusy(false)
    }
  }

  function beginEditPreset() {
    if (!selectedPreset) return
    setForm({
      name: selectedPreset.name ?? '',
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
    setShowNewPreset(true)
  }

  function cancelPresetForm() {
    setShowNewPreset(false)
    setEditingPresetId('')
    setForm(emptyPreset)
    setFromSearch('')
    setToSearch('')
    setError('')
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
        name: form.name.trim(),
        sourceName: form.sourceName.trim(),
        destinationName: form.destinationName.trim(),
        destinationAddress: form.destinationAddress.trim(),
        fromAmount: form.fromAmount.trim(),
        destinationExtraId: form.destinationExtraId.trim(),
        refundAddress: form.refundAddress.trim(),
        refundExtraId: form.refundExtraId.trim(),
      }
      if (editingPresetId) {
        await updatePreset(user.uid, editingPresetId, preset)
      } else {
        await createPreset(user.uid, preset)
      }
      await refreshPresets()
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
    if (!selectedPreset || !window.confirm(`Delete “${selectedPreset.name}”?`)) return
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
    })
    return result.data
  }

  async function requestQuote() {
    if (!selectedPreset) return
    setBusy(true)
    setError('')
    setNotice('Checking the current minimum and estimate…')
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
      })
      setQuote(result.data)
      setConfirming(true)
      setNotice('')
    } catch (quoteError) {
      setError(getErrorMessage(quoteError))
      setNotice('')
    } finally {
      setBusy(false)
    }
  }

  async function confirmSwap() {
    if (!selectedPreset || !quote?.quoteId) return
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
      setTunnel(created)
      setTunnelPreset(selectedPreset)
      setQuote(null)

      const sourceWallet = getSourceWalletName(selectedPreset)
      setNotice(`Tunnel ready. Send only ${selectedPreset.fromCurrency?.toUpperCase()} on ${selectedPreset.fromNetwork?.toUpperCase()} from ${sourceWallet} to this address.`)
    } catch (swapError) {
      setError(getErrorMessage(swapError))
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
          <span className="brand-mark" aria-hidden="true">↔</span>
          <span>AutoSwap <i>Route Desk</i></span>
        </a>
        <div className="account-menu">
          <span className="account-email">{user.email}</span>
          <button className="button button-quiet" onClick={() => signOut(auth)} type="button">Sign out</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="route-rail">
          <div className="rail-heading">
            <div><p className="eyebrow">YOUR WORKSPACE</p><h2>Saved routes</h2></div>
            <button className="icon-button" aria-label="Create route" title="Create route" onClick={toggleNewPreset} type="button">+</button>
          </div>
          {presets.length === 0 && <p className="empty-routes">No routes saved yet.</p>}
          <nav className="route-list" aria-label="Saved routes">
            {presets.map((preset) => (
              <button
                className={`route-item ${selectedId === preset.id ? 'route-item-active' : ''}`}
                key={preset.id}
                onClick={() => { setSelectedId(preset.id); setQuote(null); setTunnel(null); setTunnelPreset(null); setNotice(''); setError('') }}
                type="button"
              >
                <span className="route-item-top"><span>{preset.name}</span><span className="route-dot" /></span>
                <span className="route-item-path">{preset.fromCurrency?.toUpperCase()} <b>→</b> {preset.toCurrency?.toUpperCase()}</span>
                <span className="route-item-mode">MANUAL SWAP</span>
              </button>
            ))}
          </nav>
          <div className="rail-note"><span className="status-led" /> Route details are confirmed before each tunnel is created.</div>
        </aside>

        <section className="desk-content">
          <div className="page-heading">
            <div><p className="eyebrow">SWAP AUTOMATION / PERSONAL</p><h1>Route Desk</h1></div>
            {selectedPreset && <button className="button button-quiet delete-button" onClick={removePreset} type="button">Delete route</button>}
          </div>

          {!isFirebaseConfigured && <div className="notice notice-warning">Firebase is not configured. Add the VITE_FIREBASE_* values before signing in or saving routes.</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {addressBookError && <div className="notice notice-error" role="alert">{addressBookError}</div>}

          {showNewPreset && (
            <section className="panel new-route-panel">
              <div className="panel-heading"><div><p className="eyebrow">{editingPresetId ? 'EDIT PRESET' : 'NEW PRESET'}</p><h2>{editingPresetId ? 'Edit saved route' : 'Route details'}</h2></div></div>
              <form className="preset-form" onSubmit={savePreset}>
                <label className="field-wide">Saved preset name<input name="name" value={form.name} onChange={updateForm} placeholder="For example, BTC to ETH" maxLength="48" required /></label>
                <p className="field-note field-wide">Use this name to identify the saved route later. It does not affect the swap.</p>
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
            <section className="empty-state"><div className="empty-glyph" aria-hidden="true">↗</div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Create your first route.</h2><p>Save your swap details and destination addresses for easy reuse.</p><button className="button button-primary" onClick={() => setShowNewPreset(true)} type="button">Create a route <span aria-hidden="true">+</span></button></section>
          )}

          {selectedPreset && !showNewPreset && (
            <>
              <section className="route-summary">
                <div className="summary-origin"><span className="summary-label">FROM</span><strong>{getSourceWalletName(selectedPreset)}</strong><small>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()} · {selectedPreset.fromNetwork?.toUpperCase()}</small></div>
                <div className="summary-destination"><span className="summary-label">TO</span><strong>{getDestinationWalletName(selectedPreset)}</strong><small>{selectedPreset.toCurrency?.toUpperCase()} · {selectedPreset.toNetwork?.toUpperCase()}</small></div>
              </section>
              <section className="panel active-route-panel">
                <div className="panel-heading"><div><p className="eyebrow">ACTIVE PRESET</p><h2>{selectedPreset.name}</h2></div><span className="panel-index">01 / ROUTE</span></div>
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

          {notice && <div className="notice notice-success" role="status">{notice}</div>}

          {tunnel && (
            <section className="panel tunnel-panel">
              <div className="panel-heading"><div><p className="eyebrow">DEPOSIT DETAILS</p><h2>Swap tunnel ready</h2></div><span className="live-badge">LIVE</span></div>
              <p className="field-note">Send only {(tunnelPreset ?? selectedPreset)?.fromCurrency?.toUpperCase()} on {(tunnelPreset ?? selectedPreset)?.fromNetwork?.toUpperCase()} from {getSourceWalletName(tunnelPreset ?? selectedPreset)}. Sending another asset or network can permanently lose funds.</p>
              <div className="deposit-address"><span>Deposit address</span><code>{tunnel.payinAddress}</code><button className="button button-quiet" onClick={() => navigator.clipboard?.writeText(tunnel.payinAddress)} type="button">Copy address</button></div>
              {tunnel.payinExtraId && <div className="deposit-address"><span>Required deposit memo or tag</span><code>{tunnel.payinExtraId}</code><button className="button button-quiet" onClick={() => navigator.clipboard?.writeText(tunnel.payinExtraId)} type="button">Copy memo or tag</button></div>}
              {tunnel.transactionHash && <div className="transaction-hash"><span>Wallet transaction</span><code>{tunnel.transactionHash}</code></div>}
              {tunnel.id && <p className="field-note">Exchange ID: {tunnel.id}</p>}
            </section>
          )}
        </section>
      </main>

      {addressBookDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddressBookDialog('') }}>
          <section className="confirm-modal address-book-modal" role="dialog" aria-modal="true" aria-labelledby="address-book-title">
            <p className="eyebrow">PRIVATE TO YOUR ACCOUNT</p>
            <h2 id="address-book-title">{addressBookDialog === 'save' ? 'Save address' : 'Address book'}</h2>
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
            <h2 id="confirm-title">Confirm this route?</h2>
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
            <p className="modal-warning">This standard-flow estimate is indicative and may change. Confirming creates the exchange. Your wallet will ask for separate approval before sending funds.</p>
            <div className="form-actions"><button className="button button-quiet" onClick={() => setConfirming(false)} type="button">Go back</button><button className="button button-primary" disabled={busy} onClick={confirmSwap} type="button">{busy ? 'Creating tunnel…' : 'Confirm & create tunnel'}</button></div>
          </section>
        </div>
      )}
    </div>
  )
}