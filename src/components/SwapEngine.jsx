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
  chainId: '1',
  destinationName: 'Trust Wallet',
  destinationAddress: '',
}

const nativeEvmRoutes = {
  eth: { chainId: 1, currencies: ['eth'] },
  polygon: { chainId: 137, currencies: ['matic', 'pol'] },
  bsc: { chainId: 56, currencies: ['bnb'] },
  arbitrum: { chainId: 42161, currencies: ['eth'] },
  optimism: { chainId: 10, currencies: ['eth'] },
  base: { chainId: 8453, currencies: ['eth'] },
  avaxc: { chainId: 43114, currencies: ['avax'] },
}

function getErrorMessage(error) {
  if (error?.code === 'functions/permission-denied') return 'Sign in again before creating a swap.'
  if (error?.code === 'functions/invalid-argument') return error.message
  return error?.message || 'The route could not be completed. Check the route and try again.'
}

export default function SwapEngine({ user }) {
  const [presets, setPresets] = useState([])
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

  async function refreshPresets() {
    const saved = await listPresets(user.uid)
    setPresets(saved)
    if (!saved.some((preset) => preset.id === selectedId)) setSelectedId(saved[0]?.id ?? '')
  }

  useEffect(() => {
    refreshPresets().catch(() => setError('Saved routes could not be loaded. Check your Firebase setup.'))
  }, [user.uid])

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'fundingMethod' ? { destinationName: value === 'venmo' ? 'Trust Wallet' : 'PayPal' } : {}),
    }))
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
        chainId: Number(form.chainId),
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

  async function createTunnel(preset) {
    const create = httpsCallable(functions, 'createSwapTunnel')
    const result = await create({
      fromCurrency: preset.fromCurrency,
      fromNetwork: preset.fromNetwork,
      toCurrency: preset.toCurrency,
      toNetwork: preset.toNetwork,
      fromAmount: preset.fromAmount,
      toAddress: preset.destinationAddress,
    })
    return result.data
  }

  async function requestQuote() {
    if (!selectedPreset) return
    setBusy(true)
    setError('')
    setNotice('Checking the current minimum and estimate…')

    try {
      if (selectedPreset.fundingMethod === 'trust-wallet') {
        const route = nativeEvmRoutes[selectedPreset.fromNetwork?.toLowerCase()]
        if (!route || !route.currencies.includes(selectedPreset.fromCurrency?.toLowerCase())) {
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
    if (!selectedPreset || !quote) return
    setBusy(true)
    setError('')
    setNotice('Creating a swap tunnel…')
    setConfirming(false)
    setTunnel(null)

    try {
      let route = null
      if (selectedPreset.fundingMethod === 'trust-wallet') {
        route = nativeEvmRoutes[selectedPreset.fromNetwork?.toLowerCase()]
        if (!route || !route.currencies.includes(selectedPreset.fromCurrency?.toLowerCase())) {
          throw new Error('Wallet automation supports native EVM coins only. Check that the currency and network are a supported pair.')
        }
        if (Number(selectedPreset.chainId) !== route.chainId) {
          throw new Error(`This route requires chain ${route.chainId} for ${selectedPreset.fromNetwork}.`)
        }
      }

      const created = await createTunnel(selectedPreset)
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
                <label>From currency<input name="fromCurrency" value={form.fromCurrency} onChange={updateForm} placeholder="eth" required /></label>
                <label>From network<input name="fromNetwork" value={form.fromNetwork} onChange={updateForm} placeholder="eth" required /></label>
                <label>To currency<input name="toCurrency" value={form.toCurrency} onChange={updateForm} placeholder="btc" required /></label>
                <label>To network<input name="toNetwork" value={form.toNetwork} onChange={updateForm} placeholder="btc" required /></label>
                <label>Amount<input name="fromAmount" inputMode="decimal" value={form.fromAmount} onChange={updateForm} placeholder="0.05" required /></label>
                {form.fundingMethod === 'trust-wallet' && <label>Wallet chain ID<input name="chainId" inputMode="numeric" value={form.chainId} onChange={updateForm} required /></label>}
                <label className="field-wide">Destination name<input name="destinationName" value={form.destinationName} onChange={updateForm} placeholder="Trust Wallet / PayPal" required /></label>
                <label className="field-wide">Destination crypto address<input name="destinationAddress" value={form.destinationAddress} onChange={updateForm} autoComplete="off" placeholder="Wallet address supplied by the destination" required /></label>
                <p className="field-note field-wide">Use a supported cryptocurrency address. A PayPal email or account ID is not a crypto deposit address. Wallet automation supports native EVM coins only.</p>
                <div className="form-actions field-wide"><button className="button button-quiet" onClick={() => setShowNewPreset(false)} type="button">Cancel</button><button className="button button-primary" type="submit">Save route</button></div>
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
              {tunnel.transactionHash && <div className="transaction-hash"><span>Wallet transaction</span><code>{tunnel.transactionHash}</code></div>}
              {tunnel.id && <p className="field-note">Exchange ID: {tunnel.id}</p>}
            </section>
          )}
        </section>
      </main>

      {confirming && selectedPreset && quote && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(false) }}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">FINAL REVIEW</p>
            <h2 id="confirm-title">Confirm this route?</h2>
            <p className="muted">Review the live estimate before creating a deposit tunnel.</p>
            <dl className="confirmation-list">
              <div><dt>Send</dt><dd>{selectedPreset.fromAmount} {selectedPreset.fromCurrency?.toUpperCase()} on {selectedPreset.fromNetwork}</dd></div>
              <div><dt>Receive</dt><dd>{selectedPreset.toCurrency?.toUpperCase()} on {selectedPreset.toNetwork}</dd></div>
              <div><dt>Estimated receive</dt><dd>{quote.estimatedAmount} {selectedPreset.toCurrency?.toUpperCase()}</dd></div>
              <div><dt>Minimum send</dt><dd>{quote.minimumAmount} {selectedPreset.fromCurrency?.toUpperCase()}</dd></div>
              <div><dt>Destination</dt><dd>{selectedPreset.destinationName}<br /><code>{selectedPreset.destinationAddress}</code></dd></div>
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