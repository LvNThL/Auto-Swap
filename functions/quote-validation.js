const EXCHANGE_FIELDS = [
  'fromCurrency',
  'fromNetwork',
  'toCurrency',
  'toNetwork',
  'fromAmount',
  'toAddress',
  'toExtraId',
]

function quoteMatchesExchange(quote, exchange) {
  return EXCHANGE_FIELDS.every((field) => quote[field] === exchange[field])
}

function quoteExpired(expiresAt, now = Date.now()) {
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

module.exports = { quoteMatchesExchange, quoteExpired }