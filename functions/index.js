const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { quoteMatchesExchange, quoteMatchesPreset, quoteExpired } = require('./quote-validation')
const { normalizeCurrencyCatalog } = require('./currency-catalog')
const { depositReceived, pendingHistoryStatus } = require('./swap-history-status')
const { extractTransactionHistoryDetails } = require('./transaction-history-details')
const {
  MAX_ADDRESS_BOOK_ENTRIES_PER_USER,
  MAX_DAILY_SAVED_RECORD_WRITES,
  MAX_PRESETS_PER_USER,
  validateAddressBookEntry,
  validatePreset,
} = require('./saved-record-validation')

initializeApp()

const changeNowApiKey = defineSecret('CHANGENOW_API_KEY')
const database = getFirestore()
const CHANGE_NOW_URL = 'https://api.changenow.io/v2/exchange'
const QUOTE_COOLDOWN_MS = 2000
const CREATE_COOLDOWN_MS = 10000
const QUOTE_TTL_MS = 60000
const TUNNEL_ACCESS_TTL_MS = 5 * 60 * 1000
const PENDING_SWAP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CURRENCY_CACHE_TTL_MS = 300000
const SAVED_RECORD_WRITE_COOLDOWN_MS = 1000
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

function swapHistoryCollection(uid) {
  return database.collection('users').doc(uid).collection('swapHistory')
}

function serializeSwapHistory(snapshot) {
  const record = snapshot.data()
  return {
    id: snapshot.id,
    exchangeId: record.exchangeId ?? null,
    fromCurrency: record.fromCurrency,
    fromNetwork: record.fromNetwork,
    fromAmount: record.fromAmount,
    toCurrency: record.toCurrency,
    toNetwork: record.toNetwork,
    toAmount: record.toAmount ?? null,
    networkFee: record.networkFee ?? null,
    networkFeeCurrency: record.networkFeeCurrency ?? null,
    payinHash: record.payinHash ?? null,
    payoutHash: record.payoutHash ?? null,
    payinExplorerUrl: record.payinExplorerUrl ?? null,
    payoutExplorerUrl: record.payoutExplorerUrl ?? null,
    status: record.status ?? 'unknown',
    createdAt: record.createdAt?.toMillis() ?? null,
    updatedAt: record.updatedAt?.toMillis() ?? null,
  }
}

function getUserRecordUsageRef(uid) {
  return database.collection('users').doc(uid).collection('_privateMeta').doc('recordUsage')
}

function recordCountFromSnapshot(snapshot, maximum) {
  return {
    count: Math.min(snapshot.size, maximum + 1),
    overflow: snapshot.size > maximum,
  }
}

async function readInitialRecordUsage(transaction, uid, presetSnapshot = null, addressSnapshot = null) {
  const userRef = database.collection('users').doc(uid)
  const [presets, addresses] = await Promise.all([
    presetSnapshot ?? transaction.get(userRef.collection('presets').limit(MAX_PRESETS_PER_USER + 1)),
    addressSnapshot ?? transaction.get(userRef.collection('addressBook').limit(MAX_ADDRESS_BOOK_ENTRIES_PER_USER + 1)),
  ])
  const presetCount = recordCountFromSnapshot(presets, MAX_PRESETS_PER_USER)
  const addressCount = recordCountFromSnapshot(addresses, MAX_ADDRESS_BOOK_ENTRIES_PER_USER)

  return {
    presetCount: presetCount.count,
    presetOverflow: presetCount.overflow,
    addressCount: addressCount.count,
    addressOverflow: addressCount.overflow,
  }
}

function getCountAfterDelete(count, overflow, snapshotSize, maximum) {
  if (overflow || count > maximum) {
    if (snapshotSize <= maximum + 1) return { count: Math.max(0, snapshotSize - 1), overflow: false }
    return { count: maximum + 1, overflow: true }
  }
  return { count: Math.max(0, count - 1), overflow: false }
}

function validateSavedRecord(validator, input) {
  try {
    return validator(input)
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message)
  }
}

function requiredRecordId(value, field) {
  const id = requiredString(value, field, 128)
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new HttpsError('invalid-argument', `Invalid ${field}.`)
  return id
}

async function getMatchingSavedPreset(uid, value, exchange) {
  const presetId = requiredRecordId(value, 'presetId')
  const snapshot = await database.collection('users').doc(uid).collection('presets').doc(presetId).get()
  if (!snapshot.exists) throw new HttpsError('failed-precondition', 'The selected saved route could not be found. Refresh routes and try again.')

  const preset = snapshot.data()
  if (!quoteMatchesPreset(preset, exchange)) {
    throw new HttpsError('failed-precondition', 'The selected saved route has changed. Refresh routes and request a new quote.')
  }

  return { presetId, sourceName: preset.sourceName ?? '' }
}

async function saveUserRecord(uid, collectionName, record, maximum, countField, recordId = '') {
  const collectionRef = database.collection('users').doc(uid).collection(collectionName)
  const recordRef = recordId ? collectionRef.doc(recordId) : collectionRef.doc()
  const usageRef = getUserRecordUsageRef(uid)
  const globalUsageRef = database.collection('_swapGlobalLimits').doc('savedRecordWrites')
  if (recordId && !(await recordRef.get()).exists) throw new HttpsError('not-found', 'Saved record not found.')
  await enforceRequestCooldown(uid, 'saved-record-write', SAVED_RECORD_WRITE_COOLDOWN_MS)
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)

  await database.runTransaction(async (transaction) => {
    const [recordSnapshot, usageSnapshot, globalUsageSnapshot] = await Promise.all([
      transaction.get(recordRef),
      transaction.get(usageRef),
      transaction.get(globalUsageRef),
    ])

    if (recordId && !recordSnapshot.exists) throw new HttpsError('not-found', 'Saved record not found.')

    const usage = usageSnapshot.exists
      ? usageSnapshot.data()
      : recordId ? null : await readInitialRecordUsage(transaction, uid)
    if (!recordId && usage[countField] >= maximum) {
      throw new HttpsError('resource-exhausted', `This account has reached its limit of ${maximum} saved records in this category. Delete an unused record before adding another.`)
    }

    const globalUsage = globalUsageSnapshot.data()
    const dailyCount = globalUsage?.day === day ? globalUsage.count : 0
    if (dailyCount >= MAX_DAILY_SAVED_RECORD_WRITES) {
      throw new HttpsError('resource-exhausted', 'The app-wide daily saved-record limit has been reached. Try again tomorrow.')
    }

    if (recordId) {
      const createdAt = recordSnapshot.data().createdAt instanceof Timestamp
        ? recordSnapshot.data().createdAt
        : Timestamp.fromMillis(now)
      transaction.set(recordRef, { ...record, createdAt, updatedAt: Timestamp.fromMillis(now) })
    } else {
      transaction.create(recordRef, {
        ...record,
        createdAt: Timestamp.fromMillis(now),
        updatedAt: Timestamp.fromMillis(now),
      })
      transaction.set(usageRef, {
        ...usage,
        [countField]: usage[countField] + 1,
        [`${countField === 'presetCount' ? 'preset' : 'address'}Overflow`]: false,
      })
    }

    transaction.set(globalUsageRef, { day, count: dailyCount + 1, updatedAt: Timestamp.fromMillis(now) })
  })

  return recordRef.id
}

async function deleteUserRecord(uid, collectionName, maximum, countField, recordId) {
  const userRef = database.collection('users').doc(uid)
  const collectionRef = userRef.collection(collectionName)
  const recordRef = collectionRef.doc(recordId)
  const usageRef = getUserRecordUsageRef(uid)
  if (!(await recordRef.get()).exists) throw new HttpsError('not-found', 'Saved record not found.')
  await enforceRequestCooldown(uid, 'saved-record-write', SAVED_RECORD_WRITE_COOLDOWN_MS)

  await database.runTransaction(async (transaction) => {
    const [recordSnapshot, usageSnapshot, recordListSnapshot] = await Promise.all([
      transaction.get(recordRef),
      transaction.get(usageRef),
      transaction.get(collectionRef.limit(maximum + 2)),
    ])
    if (!recordSnapshot.exists) throw new HttpsError('not-found', 'Saved record not found.')

    const usage = usageSnapshot.exists
      ? usageSnapshot.data()
      : await readInitialRecordUsage(
        transaction,
        uid,
        collectionName === 'presets' ? recordListSnapshot : null,
        collectionName === 'addressBook' ? recordListSnapshot : null,
      )
    const isPreset = collectionName === 'presets'
    const countResult = getCountAfterDelete(
      usage[countField] ?? 0,
      usage[isPreset ? 'presetOverflow' : 'addressOverflow'] === true,
      recordListSnapshot.size,
      maximum,
    )

    transaction.delete(recordRef)
    transaction.set(usageRef, {
      ...usage,
      [countField]: countResult.count,
      [isPreset ? 'presetOverflow' : 'addressOverflow']: countResult.overflow,
    })
  })
}

const terminalSwapStatuses = new Set(['finished', 'failed', 'refunded', 'expired', 'cancelled'])

async function consumeQuote(uid, quoteId, exchange, presetId) {
  const quoteRef = database.collection('users').doc(uid).collection('swapQuotes').doc(quoteId)
  const presetRef = database.collection('users').doc(uid).collection('presets').doc(presetId)
  const rateLimitRef = database.collection('_swapRateLimits').doc(`${uid}-create`)

  await database.runTransaction(async (transaction) => {
    const [quoteSnapshot, presetSnapshot, rateLimitSnapshot] = await Promise.all([
      transaction.get(quoteRef),
      transaction.get(presetRef),
      transaction.get(rateLimitRef),
    ])

    if (!quoteSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Quote is missing or does not belong to this account. Request a new quote.')
    }
    if (!presetSnapshot.exists || !quoteMatchesPreset(presetSnapshot.data(), exchange)) {
      throw new HttpsError('failed-precondition', 'The selected saved route has changed. Refresh routes and request a new quote.')
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
    if (quote.presetId && quote.presetId !== presetId) {
      throw new HttpsError('failed-precondition', 'This quote belongs to a different saved route. Request a new quote.')
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
  const toExtraId = data.toExtraId == null || data.toExtraId === ''
    ? ''
    : requiredString(data.toExtraId, 'toExtraId', 256)
  const refundAddress = data.refundAddress == null || data.refundAddress === ''
    ? ''
    : requiredString(data.refundAddress, 'refundAddress', 256)
  const refundExtraId = data.refundExtraId == null || data.refundExtraId === ''
    ? ''
    : requiredString(data.refundExtraId, 'refundExtraId', 256)

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(fromAmount) || !Number.isFinite(Number(fromAmount)) || Number(fromAmount) <= 0) {
    throw new HttpsError('invalid-argument', 'Amount must be a positive decimal value.')
  }

  return { fromCurrency, fromNetwork, toCurrency, toNetwork, fromAmount, toAddress, toExtraId, refundAddress, refundExtraId }
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
    const providerMessage = [result.message, result.errorMessage, result.error?.message, result.error]
      .find((value) => typeof value === 'string')
      ?.replace(/0x[a-f\d]{40}/gi, '[address]')
      .replace(/\bf1[a-z\d]{30,}\b/gi, '[address]')
      .replace(/\b[a-f\d]{64,}\b/gi, '[redacted]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 180)
    console.warn('ChangeNOW rejected a request:', JSON.stringify({ status: response.status, message: providerMessage ?? null }))
    throw new HttpsError(
      'failed-precondition',
      providerMessage
        ? `ChangeNOW rejected this request: ${providerMessage}`
        : 'ChangeNOW rejected this request. Verify the currencies, network, amount, and destination.',
    )
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
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 5, invoker: 'public', cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'] },
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

exports.getSwapMinimum = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 5, invoker: 'public', cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'] },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = {
      fromCurrency: requiredString(request.data?.fromCurrency, 'fromCurrency', 32).toLowerCase(),
      fromNetwork: requiredString(request.data?.fromNetwork, 'fromNetwork', 32).toLowerCase(),
      toCurrency: requiredString(request.data?.toCurrency, 'toCurrency', 32).toLowerCase(),
      toNetwork: requiredString(request.data?.toNetwork, 'toNetwork', 32).toLowerCase(),
    }
    const minimum = await callChangeNow(`/min-amount?${buildQuery(exchange)}`)
    const minimumAmount = minimum.minAmount ?? minimum.minimumAmount
    if ((typeof minimumAmount !== 'string' && typeof minimumAmount !== 'number') ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(minimumAmount))) {
      throw new HttpsError('unavailable', 'ChangeNOW returned an invalid minimum-amount response.')
    }

    return { minimumAmount: String(minimumAmount) }
  },
)

exports.getSwapQuote = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 5, invoker: 'public', cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'] },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = validateExchangeRequest(request.data)
    const toAddress = requiredString(exchange.toAddress, 'toAddress', 256)
    const quotedExchange = { ...exchange, toAddress }

    await enforceRequestCooldown(request.auth.uid, 'quote', QUOTE_COOLDOWN_MS)
    const { presetId, sourceName } = await getMatchingSavedPreset(request.auth.uid, request.data?.presetId, quotedExchange)
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
    if ((typeof estimatedAmount !== 'string' && typeof estimatedAmount !== 'number') ||
      !Number.isFinite(Number(estimatedAmount)) || Number(estimatedAmount) <= 0) {
      throw new HttpsError('failed-precondition', 'ChangeNOW did not return a usable live estimate for this exact pair. No deposit address can be created; do not send funds.')
    }

    const quotedAt = Date.now()
    const quoteExpiresAt = quotedAt + QUOTE_TTL_MS
    const quoteRef = database.collection('users').doc(request.auth.uid).collection('swapQuotes').doc()
    await quoteRef.create({
      userId: request.auth.uid,
      ...quotedExchange,
      presetId,
      sourceName,
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
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 5, invoker: 'public', cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'] },
  async (request) => {
    assertVerifiedUser(request)
    const exchange = validateExchangeRequest(request.data)
    const toAddress = requiredString(exchange.toAddress, 'toAddress', 256)
    const quoteId = requiredString(request.data?.quoteId, 'quoteId', 128)
    const presetId = requiredRecordId(request.data?.presetId, 'presetId')

    await consumeQuote(request.auth.uid, quoteId, { ...exchange, toAddress }, presetId)
    const result = await callChangeNow('', {
      method: 'POST',
      body: {
        fromCurrency: exchange.fromCurrency,
        fromNetwork: exchange.fromNetwork,
        toCurrency: exchange.toCurrency,
        toNetwork: exchange.toNetwork,
        fromAmount: exchange.fromAmount,
        address: toAddress,
        ...(exchange.toExtraId ? { extraId: exchange.toExtraId } : {}),
        ...(exchange.refundAddress ? { refundAddress: exchange.refundAddress } : {}),
        ...(exchange.refundExtraId ? { refundExtraId: exchange.refundExtraId } : {}),
        flow: 'standard',
        type: 'direct',
      },
    })

    const payinAddress = result.payinAddress ?? result.depositAddress
    if (typeof payinAddress !== 'string' || !payinAddress.trim()) {
      throw new HttpsError('unavailable', 'ChangeNOW did not return a deposit address.')
    }

    const exchangeId = result.id ?? result.exchangeId ?? null
    const transactionDetails = extractTransactionHistoryDetails(result, {
      fromNetwork: exchange.fromNetwork,
      toNetwork: exchange.toNetwork,
    })
    const tunnelOpenedAt = Date.now()
    const accessExpiresAt = tunnelOpenedAt + TUNNEL_ACCESS_TTL_MS
    let trackingSaved = false
    if (typeof exchangeId === 'string') {
      try {
        await database.collection('users').doc(request.auth.uid).collection('swapQuotes').doc(quoteId).update({
          exchangeId,
          status: typeof result.status === 'string' ? result.status : 'waiting',
          trackingStatus: 'pending',
          payinAddress,
          payinExtraId: result.payinExtraId ?? null,
          ...transactionDetails,
          tunnelOpenedAt: Timestamp.fromMillis(tunnelOpenedAt),
          tunnelAccessExpiresAt: Timestamp.fromMillis(accessExpiresAt),
          updatedAt: Timestamp.fromMillis(tunnelOpenedAt),
          expiresAt: Timestamp.fromMillis(tunnelOpenedAt + PENDING_SWAP_RETENTION_MS),
        })
        trackingSaved = true
      } catch (trackingError) {
        console.error('Could not save pending swap tracking:', trackingError.message)
      }
    }

    return {
      id: exchangeId,
      payinAddress,
      payinExtraId: result.payinExtraId ?? null,
      payoutAddress: result.payoutAddress ?? null,
      fromAmount: String(result.fromAmount ?? exchange.fromAmount),
      toAmount: result.toAmount == null ? null : String(result.toAmount),
      status: result.status ?? 'waiting',
      accessExpiresAt,
      trackingSaved,
    }
  },
)

exports.getSwapHistory = onCall(
  { region: 'us-central1', maxInstances: 5, invoker: 'public', cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'] },
  async (request) => {
    assertVerifiedUser(request)
    const userQuotes = database.collection('users').doc(request.auth.uid).collection('swapQuotes')
    const [snapshot, pendingSnapshot] = await Promise.all([
      swapHistoryCollection(request.auth.uid).orderBy('createdAt', 'desc').limit(50).get(),
      userQuotes.where('trackingStatus', '==', 'pending').limit(50).get(),
    ])

    return {
      swaps: snapshot.docs.map(serializeSwapHistory),
      pendingSwaps: pendingSnapshot.docs.map((pendingDoc) => ({
        id: pendingDoc.id,
        presetId: pendingDoc.get('presetId') ?? null,
        exchangeId: pendingDoc.get('exchangeId'),
        status: pendingDoc.get('status') ?? 'waiting',
        payinAddress: pendingDoc.get('payinAddress') ?? null,
        payinExtraId: pendingDoc.get('payinExtraId') ?? null,
        sourceName: pendingDoc.get('sourceName') ?? '',
        fromCurrency: pendingDoc.get('fromCurrency'),
        fromNetwork: pendingDoc.get('fromNetwork'),
        fromAmount: pendingDoc.get('fromAmount'),
        toCurrency: pendingDoc.get('toCurrency'),
        toNetwork: pendingDoc.get('toNetwork'),
        estimatedAmount: pendingDoc.get('estimatedAmount') ?? null,
        networkFee: pendingDoc.get('networkFee') ?? null,
        networkFeeCurrency: pendingDoc.get('networkFeeCurrency') ?? null,
        payinHash: pendingDoc.get('payinHash') ?? null,
        payoutHash: pendingDoc.get('payoutHash') ?? null,
        payinExplorerUrl: pendingDoc.get('payinExplorerUrl') ?? null,
        payoutExplorerUrl: pendingDoc.get('payoutExplorerUrl') ?? null,
        createdAt: pendingDoc.get('tunnelOpenedAt')?.toMillis() ?? pendingDoc.get('createdAt')?.toMillis() ?? null,
        accessExpiresAt: pendingDoc.get('tunnelAccessExpiresAt')?.toMillis() ?? null,
      })),
    }
  },
)

exports.refreshSwapStatus = onCall(
  { region: 'us-central1', secrets: [changeNowApiKey], maxInstances: 5, invoker: 'public', cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'] },
  async (request) => {
    assertVerifiedUser(request)
    const exchangeId = requiredString(request.data?.exchangeId, 'exchangeId', 128)
    const historySnapshot = await swapHistoryCollection(request.auth.uid)
      .where('exchangeId', '==', exchangeId)
      .limit(1)
      .get()
    const historyDoc = historySnapshot.docs[0] ?? null
    const pendingSnapshot = historyDoc ? null : await database.collection('users').doc(request.auth.uid)
      .collection('swapQuotes')
      .where('exchangeId', '==', exchangeId)
      .limit(1)
      .get()
    const pendingDoc = pendingSnapshot?.docs[0] ?? null

    if (!historyDoc && !pendingDoc) {
      throw new HttpsError('not-found', 'This exchange is not in your swap history.')
    }

    const savedRecord = (historyDoc ?? pendingDoc).data()
    if (historyDoc && terminalSwapStatuses.has(String(savedRecord.status).toLowerCase())) {
      return serializeSwapHistory(historyDoc)
    }

    await enforceRequestCooldown(request.auth.uid, `status-${exchangeId}`, 5000)
    const result = await callChangeNow(`/by-id?id=${encodeURIComponent(exchangeId)}`)
    if (typeof result.status !== 'string' || !result.status.trim()) {
      throw new HttpsError('unavailable', 'ChangeNOW did not return a transaction status.')
    }
    const transactionDetails = extractTransactionHistoryDetails(result, {
      fromNetwork: savedRecord.fromNetwork,
      toNetwork: savedRecord.toNetwork,
    })

    if (pendingDoc) {
      const status = result.status.toLowerCase()
      if (depositReceived(status)) {
        const historyRef = swapHistoryCollection(request.auth.uid).doc(pendingDoc.id)
        await database.runTransaction(async (transaction) => {
          const pendingSnapshot = await transaction.get(pendingDoc.ref)
          if (!pendingSnapshot.exists || pendingSnapshot.get('trackingStatus') !== 'pending') return
          const pendingRecord = pendingSnapshot.data()
          transaction.set(historyRef, {
            exchangeId,
            fromCurrency: pendingRecord.fromCurrency,
            fromNetwork: pendingRecord.fromNetwork,
            fromAmount: pendingRecord.fromAmount,
            toCurrency: pendingRecord.toCurrency,
            toNetwork: pendingRecord.toNetwork,
            toAmount: result.toAmount == null ? pendingRecord.estimatedAmount ?? null : String(result.toAmount),
            ...transactionDetails,
            status: result.status,
            createdAt: pendingRecord.tunnelOpenedAt ?? pendingRecord.createdAt ?? Timestamp.fromMillis(Date.now()),
            updatedAt: Timestamp.fromMillis(Date.now()),
          })
          transaction.delete(pendingDoc.ref)
        })

        const promotedSnapshot = await historyRef.get()
        return promotedSnapshot.exists
          ? { ...serializeSwapHistory(promotedSnapshot), historyCreated: true }
          : { id: pendingDoc.id, exchangeId, status: result.status, pending: true }
      }

      if (status === 'expired') {
        const historyRef = swapHistoryCollection(request.auth.uid).doc(pendingDoc.id)
        await database.runTransaction(async (transaction) => {
          const currentPending = await transaction.get(pendingDoc.ref)
          if (!currentPending.exists || currentPending.get('trackingStatus') !== 'pending') return
          const pendingRecord = currentPending.data()
          const now = Timestamp.fromMillis(Date.now())
          transaction.set(historyRef, {
            exchangeId,
            fromCurrency: pendingRecord.fromCurrency,
            fromNetwork: pendingRecord.fromNetwork,
            fromAmount: pendingRecord.fromAmount,
            toCurrency: pendingRecord.toCurrency,
            toNetwork: pendingRecord.toNetwork,
            toAmount: pendingRecord.estimatedAmount ?? null,
            ...transactionDetails,
            status: pendingHistoryStatus(result.status),
            createdAt: pendingRecord.tunnelOpenedAt ?? pendingRecord.createdAt ?? now,
            updatedAt: now,
          })
          transaction.delete(pendingDoc.ref)
        })

        const cancelledSnapshot = await historyRef.get()
        return cancelledSnapshot.exists
          ? { ...serializeSwapHistory(cancelledSnapshot), historyCreated: true }
          : { exchangeId, status: 'cancelled', pending: true }
      }

      await pendingDoc.ref.update({ ...transactionDetails, status: result.status, updatedAt: Timestamp.fromMillis(Date.now()) })
      return { id: pendingDoc.id, exchangeId, status: result.status, ...transactionDetails, pending: true }
    }

    await historyDoc.ref.update({
      status: result.status,
      ...(result.toAmount == null ? {} : { toAmount: String(result.toAmount) }),
      ...transactionDetails,
      updatedAt: Timestamp.fromMillis(Date.now()),
    })

    const updatedSnapshot = await historyDoc.ref.get()
    return serializeSwapHistory(updatedSnapshot)
  },
)

const savedRecordCallOptions = {
  region: 'us-central1',
  maxInstances: 5,
  invoker: 'public',
  cors: ['https://lvnthl.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'],
}

exports.saveUserPreset = onCall(savedRecordCallOptions, async (request) => {
  assertVerifiedUser(request)
  const preset = validateSavedRecord(validatePreset, request.data?.preset)
  const presetId = request.data?.presetId == null ? '' : requiredRecordId(request.data.presetId, 'presetId')
  const id = await saveUserRecord(
    request.auth.uid,
    'presets',
    preset,
    MAX_PRESETS_PER_USER,
    'presetCount',
    presetId,
  )
  return { id }
})

exports.deleteUserPreset = onCall(savedRecordCallOptions, async (request) => {
  assertVerifiedUser(request)
  const presetId = requiredRecordId(request.data?.presetId, 'presetId')
  await deleteUserRecord(request.auth.uid, 'presets', MAX_PRESETS_PER_USER, 'presetCount', presetId)
  return { deleted: true }
})

exports.saveUserAddressBookEntry = onCall(savedRecordCallOptions, async (request) => {
  assertVerifiedUser(request)
  const entry = validateSavedRecord(validateAddressBookEntry, request.data?.entry)
  const entryId = request.data?.entryId == null ? '' : requiredRecordId(request.data.entryId, 'entryId')
  const id = await saveUserRecord(
    request.auth.uid,
    'addressBook',
    entry,
    MAX_ADDRESS_BOOK_ENTRIES_PER_USER,
    'addressCount',
    entryId,
  )
  return { id }
})

exports.deleteUserAddressBookEntry = onCall(savedRecordCallOptions, async (request) => {
  assertVerifiedUser(request)
  const entryId = requiredRecordId(request.data?.entryId, 'entryId')
  await deleteUserRecord(request.auth.uid, 'addressBook', MAX_ADDRESS_BOOK_ENTRIES_PER_USER, 'addressCount', entryId)
  return { deleted: true }
})