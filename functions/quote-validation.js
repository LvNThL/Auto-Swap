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
]
const PRESET_MATCH_FIELDS = EXCHANGE_FIELDS.filter((field) => field !== 'toExtraId' && field !== 'refundExtraId')

function normalizeExchangeFlow(flow) {
  if (flow == null || flow === '') return 'standard'
  if (flow === 'standard' || flow === 'fixed-rate') return flow
  throw new TypeError('Rate flow must be standard or fixed-rate.')
}

function quoteMatchesExchange(quote, exchange) {
  return EXCHANGE_FIELDS.every((field) => quote[field] === exchange[field])
    && (quote.flow ?? 'standard') === (exchange.flow ?? 'standard')
}

function quoteMatchesPreset(preset, exchange) {
  const presetExchange = {
    fromCurrency: preset?.fromCurrency,
    fromNetwork: preset?.fromNetwork,
    toCurrency: preset?.toCurrency,
    toNetwork: preset?.toNetwork,
    fromAmount: preset?.fromAmount,
    toAddress: preset?.destinationAddress,
    toExtraId: preset?.destinationExtraId ?? '',
    refundAddress: preset?.refundAddress ?? '',
    refundExtraId: preset?.refundExtraId ?? '',
  }
  return PRESET_MATCH_FIELDS.every((field) => presetExchange[field] === exchange[field])
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

module.exports = { normalizeExchangeFlow, quoteMatchesExchange, quoteMatchesPreset, quoteExpired, getQuoteExpiresAt }