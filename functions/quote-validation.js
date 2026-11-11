const EXCHANGE_FIELDS = [
  'fromCurrency',
  'fromNetwork',
  'toCurrency',
  'toNetwork',
  'fromAmount',
  'toAddress',
  'toExtraId',
  'refundAddress',
  'refundExtraId',
  'limitEstimate',
]
const PRESET_MATCH_FIELDS = [...EXCHANGE_FIELDS.filter((field) => field !== 'toExtraId' && field !== 'refundExtraId' && field !== 'limitEstimate'), 'flow']

function normalizeExchangeFlow(flow) {
  if (flow == null || flow === '') return 'standard'
  if (flow === 'standard' || flow === 'fixed-rate') return flow
  throw new TypeError('Rate flow must be standard or fixed-rate.')
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

function normalizeLimitEstimate(value, flow = 'standard') {
  if (value == null || value === '') return ''
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError('Minimum payout must be a positive decimal string.')
  }
  if (compareDecimalStrings(value, '0') <= 0) {
    throw new TypeError('Minimum payout must be a positive decimal string.')
  }
  if (flow !== 'standard') {
    throw new TypeError('Custom slippage is only available for standard-rate swaps.')
  }
  if (compareDecimalStrings(value, '97') < 0 || compareDecimalStrings(value, '150') > 0) {
    throw new TypeError('Minimum payout must be between 97 and 150.')
  }
  return value
}

function quoteMatchesExchange(quote, exchange) {
  return EXCHANGE_FIELDS.every((field) => field === 'limitEstimate'
    ? (quote[field] ?? '') === (exchange[field] ?? '')
    : quote[field] === exchange[field])
    && (quote.flow ?? 'standard') === (exchange.flow ?? 'standard')
}

function quoteMatchesPreset(preset, exchange) {
  const presetExchange = {
    fromCurrency: preset?.fromCurrency,
    fromNetwork: preset?.fromNetwork,
    toCurrency: preset?.toCurrency,
    toNetwork: preset?.toNetwork,
    fromAmount: preset?.fromAmount,
    flow: preset?.flow ?? 'standard',
    toAddress: preset?.destinationAddress,
    toExtraId: preset?.destinationExtraId ?? '',
    refundAddress: preset?.refundAddress ?? '',
    refundExtraId: preset?.refundExtraId ?? '',
  }
  return PRESET_MATCH_FIELDS.every((field) => presetExchange[field] === (
    field === 'flow' ? exchange?.flow ?? 'standard' : exchange[field]
  ))
}

function quoteExpired(expiresAt, now = Date.now()) {
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

function getQuoteExpiresAt(quotedAt, ttlMs, providerValidUntil) {
  const localExpiry = quotedAt + ttlMs
  if (providerValidUntil == null) return localExpiry

  const providerExpiry = typeof providerValidUntil === 'number'
    ? (providerValidUntil < 1e12 ? providerValidUntil * 1000 : providerValidUntil)
    : Date.parse(providerValidUntil)
  if (!Number.isFinite(providerExpiry)) throw new TypeError('ChangeNOW returned an invalid quote expiry.')
  return providerExpiry
}

module.exports = { normalizeExchangeFlow, normalizeLimitEstimate, quoteMatchesExchange, quoteMatchesPreset, quoteExpired, getQuoteExpiresAt }