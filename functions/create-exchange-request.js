function parseDecimal(value) {
  const match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(value)
  if (!match) throw new TypeError('ChangeNOW estimate must be a positive decimal value.')

  const integer = match[1] ?? '0'
  const fraction = match[2] ?? match[3] ?? ''
  const exponent = Number(match[4] ?? 0)
  let scale = fraction.length - exponent
  let digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '')
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 1000) {
    throw new TypeError('ChangeNOW estimate precision is unsupported.')
  }
  if (scale < 0) {
    digits += '0'.repeat(-scale)
    scale = 0
  }
  return { coefficient: BigInt(digits), scale }
}

function formatDecimal(coefficient, scale) {
  const digits = coefficient.toString().padStart(scale + 1, '0')
  if (scale === 0) return digits
  const integer = digits.slice(0, -scale)
  const fraction = digits.slice(-scale).replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : integer
}

function getLimitEstimateAmount(estimatedAmount, percentage) {
  const estimate = parseDecimal(estimatedAmount)
  const percent = parseDecimal(percentage)
  return formatDecimal(estimate.coefficient * percent.coefficient, estimate.scale + percent.scale + 2)
}

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
    ...(exchange.limitEstimate
      ? { limitEstimate: getLimitEstimateAmount(quote.estimatedAmount, exchange.limitEstimate) }
      : {}),
    ...(exchange.flow === 'fixed-rate' ? { rateId: quote.rateId } : {}),
    type: 'direct',
  }
}

module.exports = { buildCreateExchangeBody, getLimitEstimateAmount }
