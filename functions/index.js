const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')

initializeApp()

const changeNowApiKey = defineSecret('CHANGENOW_API_KEY')
const database = getFirestore()
const CHANGE_NOW_URL = 'https://api.changenow.io/v2/exchange'
const QUOTE_COOLDOWN_MS = 2000
const CREATE_COOLDOWN_MS = 10000

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

function validateExchangeRequest(data = {}) {
  const fromCurrency = requiredString(data.fromCurrency, 'fromCurrency', 32).toLowerCase()
  const fromNetwork = requiredString(data.fromNetwork, 'fromNetwork', 32).toLowerCase()
  const toCurrency = requiredString(data.toCurrency, 'toCurrency', 32).toLowerCase()
  const toNetwork = requiredString(data.toNetwork, 'toNetwork', 32).toLowerCase()
  const fromAmount = requiredString(data.fromAmount, 'fromAmount', 48)
  const toAddress = data.toAddress == null ? undefined : requiredString(data.toAddress, 'toAddress', 256)

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(fromAmount) || !Number.isFinite(Number(fromAmount)) || Number(fromAmount) <= 0) {
    throw new HttpsError('invalid-argument', 'Amount must be a positive decimal value.')
  }

  return { fromCurrency, fromNetwork, toCurrency, toNetwork, fromAmount, toAddress }
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

async function callChangeNow(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`${CHANGE_NOW_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-changenow-api-key': changeNowApiKey.value(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    })
  } catch (error) {
    console.error('ChangeNOW request failed:', error.name)
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

exports.getSwapQuote = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 10 },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = validateExchangeRequest(request.data)

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

    return {
      minimumAmount: String(minimumAmount),
      estimatedAmount: String(estimatedAmount),
      transactionSpeedForecast: estimate.transactionSpeedForecast ?? null,
      warningMessage: estimate.warningMessage ?? null,
      quotedAt: Date.now(),
    }
  },
)

exports.createSwapTunnel = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 10 },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = validateExchangeRequest(request.data)
    const toAddress = requiredString(exchange.toAddress, 'toAddress', 256)

    await enforceRequestCooldown(request.auth.uid, 'create', CREATE_COOLDOWN_MS)
    const result = await callChangeNow('', {
      method: 'POST',
      body: {
        fromCurrency: exchange.fromCurrency,
        fromNetwork: exchange.fromNetwork,
        toCurrency: exchange.toCurrency,
        toNetwork: exchange.toNetwork,
        fromAmount: exchange.fromAmount,
        toAddress,
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
      payoutAddress: result.payoutAddress ?? null,
      fromAmount: String(result.fromAmount ?? exchange.fromAmount),
      toAmount: result.toAmount == null ? null : String(result.toAmount),
      status: result.status ?? 'waiting',
    }
  },
)