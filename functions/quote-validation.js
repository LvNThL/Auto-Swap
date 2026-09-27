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

function quoteMatchesExchange(quote, exchange) {
  return EXCHANGE_FIELDS.every((field) => quote[field] === exchange[field])
}

function quoteMatchesPreset(preset, exchange) {
  return quoteMatchesExchange({
    fromCurrency: preset?.fromCurrency,
    fromNetwork: preset?.fromNetwork,
    toCurrency: preset?.toCurrency,
    toNetwork: preset?.toNetwork,
    fromAmount: preset?.fromAmount,
    toAddress: preset?.destinationAddress,
    toExtraId: preset?.destinationExtraId ?? '',
    refundAddress: preset?.refundAddress ?? '',
    refundExtraId: preset?.refundExtraId ?? '',
  }, exchange)
}

function quoteExpired(expiresAt, now = Date.now()) {
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

module.exports = { quoteMatchesExchange, quoteMatchesPreset, quoteExpired }