const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { quoteMatchesExchange, quoteExpired } = require('./quote-validation')
const { normalizeCurrencyCatalog } = require('./currency-catalog')

initializeApp()

const changeNowApiKey = defineSecret('CHANGENOW_API_KEY')
const database = getFirestore()
const CHANGE_NOW_URL = 'https://api.changenow.io/v2/exchange'
const QUOTE_COOLDOWN_MS = 2000
const CREATE_COOLDOWN_MS = 10000
const QUOTE_TTL_MS = 60000
const CURRENCY_CACHE_TTL_MS = 300000
let cachedCurrencies = null
let cachedCurrenciesUntil = 0

function requiredString(value, field, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HttpsError('invalid-argument', `Invalid ${field}.`)
  }
  return value.trim()
}

async function enforceRequestCooldown(uid, action, cooldownMs) {
  const rateLimitRef = database.collection('_swapRateLimits').doc(`${uid}-${action}`)
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef)
    const lastRequestAt = snapshot.data()?.lastRequestAt?.toMillis() ?? 0
    const now = Date.now()

    if (now - lastRequestAt < cooldownMs) {
      throw new HttpsError('resource-exhausted', 'Wait a few seconds before trying this action again.')
    }

    transaction.set(rateLimitRef, { lastRequestAt: Timestamp.fromMillis(now) })
  })
}

async function consumeQuote(uid, quoteId, exchange) {
  const quoteRef = database.collection('users').doc(uid).collection('swapQuotes').doc(quoteId)
  const rateLimitRef = database.collection('_swapRateLimits').doc(`${uid}-create`)

  await database.runTransaction(async (transaction) => {
    const [quoteSnapshot, rateLimitSnapshot] = await Promise.all([
      transaction.get(quoteRef),
      transaction.get(rateLimitRef),
    ])

    if (!quoteSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Quote is missing or does not belong to this account. Request a new quote.')
    }

    const quote = quoteSnapshot.data()
    const now = Date.now()
    if (quote.userId !== uid || !quote.expiresAt || quoteExpired(quote.expiresAt.toMillis(), now)) {
      throw new HttpsError('failed-precondition', 'Quote expired. Request a new quote before creating the tunnel.')
    }
    if (quote.consumedAt) {
      throw new HttpsError('failed-precondition', 'This quote has already been used. Request a new quote.')
    }
    if (!quoteMatchesExchange(quote, exchange)) {
      throw new HttpsError('failed-precondition', 'Route details changed after quoting. Request a new quote and confirm those details.')
    }

    const lastRequestAt = rateLimitSnapshot.data()?.lastRequestAt?.toMillis() ?? 0
    if (now - lastRequestAt < CREATE_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'Wait a few seconds before creating another tunnel.')
    }

    transaction.update(quoteRef, { consumedAt: Timestamp.fromMillis(now) })
    transaction.set(rateLimitRef, { lastRequestAt: Timestamp.fromMillis(now) })
  })
}

function validateExchangeRequest(data = {}) {
  const fromCurrency = requiredString(data.fromCurrency, 'fromCurrency', 32).toLowerCase()
  const fromNetwork = requiredString(data.fromNetwork, 'fromNetwork', 32).toLowerCase()
  const toCurrency = requiredString(data.toCurrency, 'toCurrency', 32).toLowerCase()
  const toNetwork = requiredString(data.toNetwork, 'toNetwork', 32).toLowerCase()
  const fromAmount = requiredString(data.fromAmount, 'fromAmount', 48)
  const toAddress = data.toAddress == null ? undefined : requiredString(data.toAddress, 'toAddress', 256)
  const toExtraId = data.toExtraId == null ? '' : requiredString(data.toExtraId, 'toExtraId', 256)

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(fromAmount) || !Number.isFinite(Number(fromAmount)) || Number(fromAmount) <= 0) {
    throw new HttpsError('invalid-argument', 'Amount must be a positive decimal value.')
  }

  return { fromCurrency, fromNetwork, toCurrency, toNetwork, fromAmount, toAddress, toExtraId }
}

function compareDecimalStrings(left, right) {
  const split = (value) => {
    const [integer, fraction = ''] = value.split('.')
    return [(integer.replace(/^0+(?=\d)/, '') || '0'), fraction]
  }
  const [leftInteger, leftFraction] = split(left)
  const [rightInteger, rightFraction] = split(right)

  if (leftInteger.length !== rightInteger.length) return leftInteger.length > rightInteger.length ? 1 : -1
  if (leftInteger !== rightInteger) return leftInteger > rightInteger ? 1 : -1

  const precision = Math.max(leftFraction.length, rightFraction.length)
  const paddedLeft = leftFraction.padEnd(precision, '0')
  const paddedRight = rightFraction.padEnd(precision, '0')
  if (paddedLeft === paddedRight) return 0
  return paddedLeft > paddedRight ? 1 : -1
}

function getChangeNowApiKey() {
  const apiKey = changeNowApiKey.value()?.trim()
  if (!apiKey || !/^[\x21-\x7E]+$/.test(apiKey)) {
    throw new HttpsError('failed-precondition', 'ChangeNOW API key is malformed. Re-enter the key without spaces or line breaks.')
  }
  return apiKey
}

async function callChangeNow(path, { method = 'GET', body } = {}) {
  const apiKey = getChangeNowApiKey()
  let response
  try {
    response = await fetch(`${CHANGE_NOW_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-changenow-api-key': apiKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    })
  } catch (error) {
    console.error('ChangeNOW request failed:', JSON.stringify({
      name: error.name,
      code: error.code ?? error.cause?.code ?? null,
      causeName: error.cause?.name ?? null,
      causeCode: error.cause?.code ?? null,
      causeMessage: error.cause?.message ?? null,
    }))
    throw new HttpsError('unavailable', 'The exchange service is temporarily unavailable.')
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new HttpsError('unavailable', 'The exchange service returned an unreadable response.')
  }

  if (!response.ok) {
    console.warn('ChangeNOW rejected a request:', response.status)
    throw new HttpsError('failed-precondition', 'ChangeNOW rejected this request. Verify the currencies, network, amount, and destination.')
  }

  return result
}

function assertVerifiedUser(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use swap routes.')
  if (!request.auth.token.email_verified) {
    throw new HttpsError('permission-denied', 'Verify your email before using swap routes.')
  }
}

function buildQuery(exchange, includeAmount = false) {
  const parameters = new URLSearchParams({
    fromCurrency: exchange.fromCurrency,
    toCurrency: exchange.toCurrency,
    fromNetwork: exchange.fromNetwork,
    toNetwork: exchange.toNetwork,
    flow: 'standard',
    type: 'direct',
  })
  if (includeAmount) parameters.set('fromAmount', exchange.fromAmount)
  return parameters.toString()
}

exports.getSwapCurrencies = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 10 },
  async (request) => {
    assertVerifiedUser(request)
    if (cachedCurrencies && Date.now() < cachedCurrenciesUntil) {
      return { currencies: cachedCurrencies }
    }

    const response = await callChangeNow('/currencies?active=true&flow=standard')
    const currencies = normalizeCurrencyCatalog(response)
    if (currencies.length === 0) {
      throw new HttpsError('unavailable', 'ChangeNOW returned no active crypto currencies.')
    }

    cachedCurrencies = currencies
    cachedCurrenciesUntil = Date.now() + CURRENCY_CACHE_TTL_MS
    return { currencies }
  },
)

exports.getSwapQuote = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 10 },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = validateExchangeRequest(request.data)
    const toAddress = requiredString(exchange.toAddress, 'toAddress', 256)
    const quotedExchange = { ...exchange, toAddress }

    await enforceRequestCooldown(request.auth.uid, 'quote', QUOTE_COOLDOWN_MS)
    const minimum = await callChangeNow(`/min-amount?${buildQuery(exchange)}`)
    const minimumAmount = minimum.minAmount ?? minimum.minimumAmount
    if ((typeof minimumAmount !== 'string' && typeof minimumAmount !== 'number') ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(minimumAmount))) {
      throw new HttpsError('unavailable', 'ChangeNOW returned an invalid minimum-amount response.')
    }
    if (compareDecimalStrings(exchange.fromAmount, String(minimumAmount)) < 0) {
      throw new HttpsError('failed-precondition', `Amount is below the current minimum of ${minimumAmount} ${exchange.fromCurrency.toUpperCase()}.`)
    }

    const estimate = await callChangeNow(`/estimated-amount?${buildQuery(exchange, true)}`)
    const estimatedAmount = estimate.estimatedAmount ?? estimate.toAmount
    if (typeof estimatedAmount !== 'string' && typeof estimatedAmount !== 'number') {
      throw new HttpsError('unavailable', 'ChangeNOW returned an invalid estimate response.')
    }

    const quotedAt = Date.now()
    const quoteExpiresAt = quotedAt + QUOTE_TTL_MS
    const quoteRef = database.collection('users').doc(request.auth.uid).collection('swapQuotes').doc()
    await quoteRef.create({
      userId: request.auth.uid,
      ...quotedExchange,
      minimumAmount: String(minimumAmount),
      estimatedAmount: String(estimatedAmount),
      createdAt: Timestamp.fromMillis(quotedAt),
      expiresAt: Timestamp.fromMillis(quoteExpiresAt),
      consumedAt: null,
    })

    return {
      quoteId: quoteRef.id,
      minimumAmount: String(minimumAmount),
      estimatedAmount: String(estimatedAmount),
      transactionSpeedForecast: estimate.transactionSpeedForecast ?? null,
      warningMessage: estimate.warningMessage ?? null,
      quotedAt,
      quoteExpiresAt,
    }
  },
)

exports.createSwapTunnel = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 10 },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = validateExchangeRequest(request.data)
    const toAddress = requiredString(exchange.toAddress, 'toAddress', 256)
    const quoteId = requiredString(request.data?.quoteId, 'quoteId', 128)

    await consumeQuote(request.auth.uid, quoteId, { ...exchange, toAddress })
    const result = await callChangeNow('', {
      method: 'POST',
      body: {
        fromCurrency: exchange.fromCurrency,
        fromNetwork: exchange.fromNetwork,
        toCurrency: exchange.toCurrency,
        toNetwork: exchange.toNetwork,
        fromAmount: exchange.fromAmount,
        toAddress,
        ...(exchange.toExtraId ? { toExtraId: exchange.toExtraId } : {}),
        flow: 'standard',
        type: 'direct',
      },
    })

    const payinAddress = result.payinAddress ?? result.depositAddress
    if (typeof payinAddress !== 'string' || !payinAddress.trim()) {
      throw new HttpsError('unavailable', 'ChangeNOW did not return a deposit address.')
    }

    return {
      id: result.id ?? result.exchangeId ?? null,
      payinAddress,
      payinExtraId: result.payinExtraId ?? null,
      payoutAddress: result.payoutAddress ?? null,
      fromAmount: String(result.fromAmount ?? exchange.fromAmount),
      toAmount: result.toAmount == null ? null : String(result.toAmount),
      status: result.status ?? 'waiting',
    }
  },
)