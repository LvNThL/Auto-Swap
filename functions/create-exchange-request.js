function buildCreateExchangeBody(exchange, toAddress, quote) {
  return {
    fromCurrency: exchange.fromCurrency,
    fromNetwork: exchange.fromNetwork,
    toCurrency: exchange.toCurrency,
    toNetwork: exchange.toNetwork,
    fromAmount: exchange.fromAmount,
    address: toAddress,
    ...(exchange.toExtraId ? { extraId: exchange.toExtraId } : {}),
    ...(exchange.refundAddress ? { refundAddress: exchange.refundAddress } : {}),
    ...(exchange.refundExtraId ? { refundExtraId: exchange.refundExtraId } : {}),
    flow: exchange.flow,
    ...(exchange.limitEstimate ? { limitEstimate: exchange.limitEstimate } : {}),
    ...(exchange.flow === 'fixed-rate' ? { rateId: quote.rateId } : {}),
    type: 'direct',
  }
}

module.exports = { buildCreateExchangeBody }
