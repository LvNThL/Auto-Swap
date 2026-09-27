import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { signOut } from 'firebase/auth'
import { auth, functions, isFirebaseConfigured } from '../firebase.js'
import { createPreset, deletePreset, listPresets } from '../services/PresetManager.js'

const emptyPreset = {
  name: '',
  fundingMethod: 'venmo',
  fromCurrency: 'btc',
  fromNetwork: 'btc',
  toCurrency: 'eth',
  toNetwork: 'eth',
  fromAmount: '',
  destinationName: 'Trust Wallet',
  destinationAddress: '',
  destinationExtraId: '',
}

const nativeEvmRoutes = {
  eth: { chainId: 1, currencies: ['eth'] },
  matic: { chainId: 137, currencies: ['matic', 'pol'] },
  bsc: { chainId: 56, currencies: ['bnb'] },
  arbitrum: { chainId: 42161, currencies: ['eth'] },
  op: { chainId: 10, currencies: ['eth'] },
  base: { chainId: 8453, currencies: ['eth'] },
  avaxc: { chainId: 43114, currencies: ['avax'] },
}

function currencyGroups(currencies) {
  const featured = currencies.filter((currency) => currency.featured)
  const other = currencies.filter((currency) => !currency.featured)
  return [
    ...(featured.length ? [{ label: 'Popular', currencies: featured }] : []),
    { label: 'All active crypto assets', currencies: other },
  ]
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

function preserveSelectedCurrency(options, selectedCurrency) {
  if (!selectedCurrency || options.some((currency) => currency.id === selectedCurrency.id)) return options
  return [selectedCurrency, ...options]
}

function isWalletNativeCurrency(currency) {
  return Boolean(
    currency &&
    !currency.tokenContract &&
    nativeEvmRoutes[currency.network]?.currencies.includes(currency.ticker),
  )
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
  const [fromSearch, setFromSearch] = useState('')
  const [toSearch, setToSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState(emptyPreset)
  const [showNewPreset, setShowNewPreset] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [quote, setQuote] = useState(null)
  const [tunnel, setTunnel] = useState(null)

  const selectedPreset = presets.find((preset) => preset.id === selectedId)
  const fromCurrencies = form.fundingMethod === 'trust-wallet'
    ? currencies.filter((currency) => currency.canSell && isWalletNativeCurrency(currency))
    : currencies.filter((currency) => currency.canSell)
  const toCurrencies = currencies.filter((currency) => currency.canBuy)
  const fromSearchLower = fromSearch.trim().toLowerCase()
  const toSearchLower = toSearch.trim().toLowerCase()
  const matchingFromCurrencies = searchCurrencies(fromCurrencies, fromSearchLower)
  const matchingToCurrencies = searchCurrencies(toCurrencies, toSearchLower)
  const selectedFromCurrency = currencies.find((currency) =>
    currency.ticker === form.fromCurrency && currency.network === form.fromNetwork)
  const selectedToCurrency = currencies.find((currency) =>
    currency.ticker === form.toCurrency && currency.network === form.toNetwork)
  const visibleFromCurrencies = preserveSelectedCurrency(matchingFromCurrencies, selectedFromCurrency)
  const visibleToCurrencies = preserveSelectedCurrency(matchingToCurrencies, selectedToCurrency)

  async function refreshPresets() {
    const saved = await listPresets(user.uid)
    setPresets(saved)
    if (!saved.some((preset) => preset.id === selectedId)) setSelectedId(saved[0]?.id ?? '')
  }

  useEffect(() => {
    let active = true
    setCurrenciesLoading(true)
    setCurrencyError('')
    refreshPresets().catch(() => setError('Saved routes could not be loaded. Check your Firebase setup.'))

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

  function updateForm(event) {
    const { name, value } = event.target
    if (name === 'fundingMethod') {
      const walletCurrency = currencies.find(isWalletNativeCurrency)
      setForm((current) => ({
        ...current,
        fundingMethod: value,
        destinationName: value === 'venmo' ? 'Trust Wallet' : 'PayPal',
        ...(value === 'trust-wallet' && walletCurrency
          ? { fromCurrency: walletCurrency.ticker, fromNetwork: walletCurrency.network }
          : {}),
      }))
      return
    }

    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'toCurrency' || name === 'toNetwork' ? { destinationExtraId: '' } : {}),
    }))
  }

  function updateSelectedCurrency(side, event) {
    const currency = currencies.find((option) => option.id === event.target.value)
    if (!currency) return

    setForm((current) => ({
      ...current,
      [`${side}Currency`]: currency.ticker,
      [`${side}Network`]: currency.network,
      ...(side === 'to' ? { destinationExtraId: '' } : {}),
    }))
    if (side === 'from') setFromSearch('')
    if (side === 'to') setToSearch('')
  }

  async function savePreset(event) {
    event.preventDefault()
    setError('')
    try {
      const preset = {
        ...form,
        name: form.name.trim(),
        destinationAddress: form.destinationAddress.trim(),
        fromAmount: form.fromAmount.trim(),
        destinationExtraId: form.destinationExtraId.trim(),
        chainId: form.fundingMethod === 'trust-wallet'
          ? nativeEvmRoutes[form.fromNetwork]?.chainId ?? null
          : null,
      }
      await createPreset(user.uid, preset)
      await refreshPresets()
      setShowNewPreset(false)
      setForm(emptyPreset)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    }
  }

  async function removePreset() {
    if (!selectedPreset || !window.confirm(`Delete “${selectedPreset.name}”?`)) return
    setError('')
    try {
      await deletePreset(user.uid, selectedPreset.id)
      setTunnel(null)
      await refreshPresets()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    }
  }

  async function getWalletProvider(chainId) {
    const trustWalletProvider = window.ethereum?.isTrust || window.ethereum?.isTrustWallet
      ? window.ethereum
      : null
    if (trustWalletProvider) {
      await trustWalletProvider.request({ method: 'eth_requestAccounts' })
      return trustWalletProvider
    }

    const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
    if (!projectId) throw new Error('Add VITE_WALLETCONNECT_PROJECT_ID to connect Trust Wallet with WalletConnect.')

    const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider')
    const provider = await EthereumProvider.init({
      projectId,
      chains: [Number(chainId)],
      showQrModal: true,
      methods: ['eth_sendTransaction', 'personal_sign'],
      events: ['chainChanged', 'accountsChanged'],
      metadata: {
        name: 'AutoSwap Route Desk',
        description: 'Review and send a confirmed swap deposit.',
        url: window.location.origin,
        icons: [],
      },
    })
    await provider.connect()
    return provider
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
      if (selectedPreset.fundingMethod === 'trust-wallet') {
        const route = nativeEvmRoutes[selectedPreset.fromNetwork?.toLowerCase()]
        const sourceCurrency = currencies.find((currency) =>
          currency.ticker === selectedPreset.fromCurrency && currency.network === selectedPreset.fromNetwork)
        if (!route || !route.currencies.includes(selectedPreset.fromCurrency?.toLowerCase()) || !isWalletNativeCurrency(sourceCurrency)) {
          throw new Error('Wallet automation supports native EVM coins only. Check that the currency and network are a supported pair.')
        }
        if (Number(selectedPreset.chainId) !== route.chainId) {
          throw new Error(`This route requires chain ${route.chainId} for ${selectedPreset.fromNetwork}.`)
        }
      }

      const getQuote = httpsCallable(functions, 'getSwapQuote')
      const result = await getQuote({
        fromCurrency: selectedPreset.fromCurrency,
        fromNetwork: selectedPreset.fromNetwork,
        toCurrency: selectedPreset.toCurrency,
        toNetwork: selectedPreset.toNetwork,
        fromAmount: selectedPreset.fromAmount,
        toAddress: selectedPreset.destinationAddress,
        toExtraId: selectedPreset.destinationExtraId,
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

    try {
      let route = null
      if (selectedPreset.fundingMethod === 'trust-wallet') {
        route = nativeEvmRoutes[selectedPreset.fromNetwork?.toLowerCase()]
        const sourceCurrency = currencies.find((currency) =>
          currency.ticker === selectedPreset.fromCurrency && currency.network === selectedPreset.fromNetwork)
        if (!route || !route.currencies.includes(selectedPreset.fromCurrency?.toLowerCase()) || !isWalletNativeCurrency(sourceCurrency)) {
          throw new Error('Wallet automation supports native EVM coins only. Check that the currency and network are a supported pair.')
        }
        if (Number(selectedPreset.chainId) !== route.chainId) {
          throw new Error(`This route requires chain ${route.chainId} for ${selectedPreset.fromNetwork}.`)
        }
      }

      const created = await createTunnel(selectedPreset, quote.quoteId)
      if (!created.payinAddress) throw new Error('ChangeNOW did not return a deposit address. The exchange may not support this route.')
      setTunnel(created)
      setQuote(null)

      if (selectedPreset.fundingMethod === 'venmo') {
        setNotice('Tunnel ready. Send only the specified asset and network to this address.')
        return
      }

      const walletProvider = await getWalletProvider(route.chainId)
      const { BrowserProvider, parseUnits } = await import('ethers')
      const provider = new BrowserProvider(walletProvider)
      const network = await provider.getNetwork()
      if (Number(network.chainId) !== route.chainId) {
        throw new Error(`Connected wallet is on chain ${network.chainId}; this route requires chain ${route.chainId}.`)
      }

      const signer = await provider.getSigner()
      // The user confirmed the route above; the wallet independently displays and authorizes
      // this native-coin recipient, amount, and network before broadcasting anything.
      const transaction = await signer.sendTransaction({
        to: created.payinAddress,
        value: parseUnits(selectedPreset.fromAmount, 18),
      })
      setTunnel({ ...created, transactionHash: transaction.hash })
      setNotice('Deposit transaction submitted. Wait for the exchange to detect the transfer.')
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
        <a className="app-brand" href="./" aria-label="AutoSwap home">
          <span className="brand-mark" aria-hidden="true">↔</span>
          <span>AutoSwap <i>route desk</i></span>
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
            <button className="icon-button" aria-label="Create route" title="Create route" onClick={() => setShowNewPreset((visible) => !visible)} type="button">+</button>
          </div>
          {presets.length === 0 && <p className="empty-routes">No routes saved yet.</p>}
          <nav className="route-list" aria-label="Saved routes">
            {presets.map((preset) => (
              <button
                className={`route-item ${selectedId === preset.id ? 'route-item-active' : ''}`}
                key={preset.id}
                onClick={() => { setSelectedId(preset.id); setQuote(null); setTunnel(null); setNotice(''); setError('') }}
                type="button"
              >
                <span className="route-item-top"><span>{preset.name}</span><span className="route-dot" /></span>
                <span className="route-item-path">{preset.fromCurrency?.toUpperCase()} <b>→</b> {preset.toCurrency?.toUpperCase()}</span>
                <span className="route-item-mode">{preset.fundingMethod === 'venmo' ? 'VENMO DEPOSIT' : 'WALLET TRANSFER'}</span>
              </button>
            ))}
          </nav>
          <div className="rail-note"><span className="status-led" /> Route details are confirmed before each tunnel is created.</div>
        </aside>

        <section className="desk-content">
          <div className="page-heading">
            <div><p className="eyebrow">SWAP AUTOMATION / PERSONAL</p><h1>Route desk<span>.</span></h1></div>
            {selectedPreset && <button className="button button-quiet delete-button" onClick={removePreset} type="button">Delete route</button>}
          </div>

          {!isFirebaseConfigured && <div className="notice notice-warning">Firebase is not configured. Add the VITE_FIREBASE_* values before signing in or saving routes.</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}

          {showNewPreset && (
            <section className="panel new-route-panel">
              <div className="panel-heading"><div><p className="eyebrow">NEW PRESET</p><h2>Route details</h2></div></div>
              <form className="preset-form" onSubmit={savePreset}>
                <label>Route name<input name="name" value={form.name} onChange={updateForm} placeholder="My ETH route" maxLength="48" required /></label>
                <label>Funding source<select name="fundingMethod" value={form.fundingMethod} onChange={updateForm}><option value="venmo">Venmo manual deposit</option><option value="trust-wallet">Trust Wallet transfer</option></select></label>
                {currenciesLoading && <p className="field-note field-wide" role="status">Loading ChangeNOW assets…</p>}
                  {currencyError && <div className="notice notice-error field-wide" role="alert">{currencyError}<button className="button button-quiet" onClick={() => setCurrencyReloadKey((key) => key + 1)} type="button">Retry asset list</button></div>}
                  <label>Find send asset<input type="search" value={fromSearch} onChange={(event) => setFromSearch(event.target.value)} placeholder="Search name, ticker, or network" /></label>
                <label>Send asset and network
                  <select
                    value={selectedFromCurrency?.id ?? ''}
                    onChange={(event) => updateSelectedCurrency('from', event)}
                    disabled={currenciesLoading || fromCurrencies.length === 0}
                    required
                  >
                    <option value="" disabled>Select a crypto asset</option>
                    {currencyGroups(visibleFromCurrencies).map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.currencies.map((currency) => (
                          <option key={currency.id} value={currency.id}>
                            {currency.name} · {currency.ticker.toUpperCase()} · {currency.network.toUpperCase()}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <p className="field-note field-wide" role="status">{fromSearchLower ? `${matchingFromCurrencies.length} send assets match.` : `Showing popular send assets. Search ${fromCurrencies.length} available options.`}</p>
                <label>Find receive asset<input type="search" value={toSearch} onChange={(event) => setToSearch(event.target.value)} placeholder="Search name, ticker, or network" /></label>
                <label>Receive asset and network
                  <select
                    value={selectedToCurrency?.id ?? ''}
                    onChange={(event) => updateSelectedCurrency('to', event)}
                    disabled={currenciesLoading || toCurrencies.length === 0}
                    required
                  >
                    <option value="" disabled>Select a crypto asset</option>
                    {currencyGroups(visibleToCurrencies).map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.currencies.map((currency) => (
                          <option key={currency.id} value={currency.id}>
                            {currency.name} · {currency.ticker.toUpperCase()} · {currency.network.toUpperCase()}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <p className="field-note field-wide" role="status">{toSearchLower ? `${matchingToCurrencies.length} receive assets match.` : `Showing popular receive assets. Search ${toCurrencies.length} available options.`}</p>
                <label>Amount<input name="fromAmount" inputMode="decimal" value={form.fromAmount} onChange={updateForm} placeholder="0.05" required /></label>
                <label className="field-wide">Destination name<input name="destinationName" value={form.destinationName} onChange={updateForm} placeholder="Trust Wallet / PayPal" required /></label>
                <label className="field-wide">Destination crypto address<input name="destinationAddress" value={form.destinationAddress} onChange={updateForm} autoComplete="off" placeholder="Wallet address supplied by the destination" required /></label>
                {selectedToCurrency?.hasExternalId && <label className="field-wide">Destination memo or tag<input name="destinationExtraId" value={form.destinationExtraId} onChange={updateForm} autoComplete="off" placeholder="Required by this asset" required /></label>}
                <p className="field-note field-wide">Assets and networks come from ChangeNOW’s active standard-flow catalog. The selected pair is checked for availability when you request a quote. Destination must be a crypto address, not a PayPal email. Wallet automation is limited to supported native EVM coins.</p>
                <div className="form-actions field-wide"><button className="button button-quiet" onClick={() => setShowNewPreset(false)} type="button">Cancel</button><button className="button button-primary" disabled={currenciesLoading || !selectedFromCurrency?.canSell || !selectedToCurrency?.canBuy} type="submit">Save route</button></div>
              </form>
            </section>
          )}

          {!selectedPreset && !showNewPreset && (
            <section className="empty-state"><div className="empty-glyph" aria-hidden="true">↗</div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Create your first route.</h2><p>Save the currencies, networks, amount, and destination address you use regularly.</p><button className="button button-primary" onClick={() => setShowNewPreset(true)} type="button">Create a route <span aria-hidden="true">+</span></button></section>
          )}

          {selectedPreset && !showNewPreset && (
            <>
              <section className="route-summary">
                <div className="summary-origin"><span className="summary-label">FROM</span><strong>{selectedPreset.fundingMethod === 'venmo' ? 'Venmo' : 'Trust Wallet'}</strong><small>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()} · {selectedPreset.fromNetwork}</small></div>
                <div className="summary-connector"><span>CHANGE NOW</span><div><i /><i /><i /><i /><i /></div></div>
                <div className="summary-destination"><span className="summary-label">TO</span><strong>{selectedPreset.destinationName}</strong><small>{selectedPreset.toCurrency?.toUpperCase()} · {selectedPreset.toNetwork}</small></div>
              </section>
              <section className="panel active-route-panel">
                <div className="panel-heading"><div><p className="eyebrow">ACTIVE PRESET</p><h2>{selectedPreset.name}</h2></div><span className="panel-index">01 / ROUTE</span></div>
                <div className="detail-grid">
                  <div><span>Send amount</span><strong>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()}</strong></div>
                  <div><span>Deposit network</span><strong>{selectedPreset.fromNetwork}</strong></div>
                  <div><span>Destination network</span><strong>{selectedPreset.toNetwork}</strong></div>
                  <div><span>Delivery address</span><strong className="address-value">{selectedPreset.destinationAddress}</strong></div>
                </div>
                <div className="panel-footer"><p>ChangeNOW checks the current minimum and estimates the receive amount before any deposit tunnel is created.</p><button className="button button-primary" disabled={busy} onClick={requestQuote} type="button">{busy ? 'Getting quote…' : 'Review swap'} <span aria-hidden="true">↗</span></button></div>
              </section>
            </>
          )}

          {notice && <div className="notice notice-success" role="status">{notice}</div>}

          {tunnel && (
            <section className="panel tunnel-panel">
              <div className="panel-heading"><div><p className="eyebrow">DEPOSIT DETAILS</p><h2>Swap tunnel ready</h2></div><span className="live-badge">LIVE</span></div>
              <p className="field-note">Send only {selectedPreset?.fromCurrency?.toUpperCase()} on {selectedPreset?.fromNetwork}. Sending another asset or network can permanently lose funds.</p>
              <div className="deposit-address"><span>Deposit address</span><code>{tunnel.payinAddress}</code><button className="button button-quiet" onClick={() => navigator.clipboard?.writeText(tunnel.payinAddress)} type="button">Copy address</button></div>
              {tunnel.payinExtraId && <div className="deposit-address"><span>Required deposit memo or tag</span><code>{tunnel.payinExtraId}</code><button className="button button-quiet" onClick={() => navigator.clipboard?.writeText(tunnel.payinExtraId)} type="button">Copy memo</button></div>}
              {tunnel.transactionHash && <div className="transaction-hash"><span>Wallet transaction</span><code>{tunnel.transactionHash}</code></div>}
              {tunnel.id && <p className="field-note">Exchange ID: {tunnel.id}</p>}
            </section>
          )}
        </section>
      </main>

      {confirming && selectedPreset && quote?.quoteId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(false) }}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">FINAL REVIEW</p>
            <h2 id="confirm-title">Confirm this route?</h2>
            <p className="muted">Review the live estimate before creating a deposit tunnel. This quote expires at {new Date(quote.quoteExpiresAt).toLocaleTimeString()}.</p>
            <dl className="confirmation-list">
              <div><dt>Send</dt><dd>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()} on {selectedPreset.fromNetwork}</dd></div>
              <div><dt>Receive</dt><dd>{selectedPreset.toCurrency?.toUpperCase()} on {selectedPreset.toNetwork}</dd></div>
              <div><dt>Estimated receive</dt><dd>{quote.estimatedAmount} {selectedPreset.toCurrency?.toUpperCase()}</dd></div>
              <div><dt>Minimum send</dt><dd>{quote.minimumAmount} {selectedPreset.fromCurrency?.toUpperCase()}</dd></div>
              <div><dt>Destination</dt><dd>{selectedPreset.destinationName}<br /><code>{selectedPreset.destinationAddress}</code></dd></div>
              {selectedPreset.destinationExtraId && <div><dt>Memo or tag</dt><dd><code>{selectedPreset.destinationExtraId}</code></dd></div>}
            </dl>
            {quote.warningMessage && <p className="modal-warning">{quote.warningMessage}</p>}
            <p className="modal-warning">This standard-flow estimate is indicative and may change. Confirming creates the exchange; your wallet will separately ask approval before sending any funds.</p>
            <div className="form-actions"><button className="button button-quiet" onClick={() => setConfirming(false)} type="button">Go back</button><button className="button button-primary" disabled={busy} onClick={confirmSwap} type="button">{busy ? 'Creating tunnel…' : 'Confirm & create tunnel'}</button></div>
          </section>
        </div>
      )}
    </div>
  )
}