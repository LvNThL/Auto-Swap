const test = require('node:test')
const assert = require('node:assert/strict')
const { quoteMatchesExchange, quoteMatchesPreset, quoteExpired } = require('../quote-validation')

const exchange = {
  fromCurrency: 'eth',
  fromNetwork: 'eth',
  toCurrency: 'btc',
  toNetwork: 'btc',
  fromAmount: '0.25',
  toAddress: 'bc1q-destination',
  toExtraId: '',
  refundAddress: 'refund-source-address',
  refundExtraId: '',
}

test('matches the exact route and destination from the quote', () => {
  assert.equal(quoteMatchesExchange({ ...exchange }, { ...exchange }), true)
})

test('rejects a changed amount, pair, network, or destination', () => {
  for (const [field, value] of Object.entries({
    fromCurrency: 'btc',
    fromNetwork: 'polygon',
    toCurrency: 'ltc',
    toNetwork: 'ltc',
    fromAmount: '0.26',
    toAddress: 'different-address',
    toExtraId: 'different-memo',
    refundAddress: 'different-refund-address',
    refundExtraId: 'different-refund-memo',
  })) {
    assert.equal(quoteMatchesExchange({ ...exchange }, { ...exchange, [field]: value }), false, field)
  }
})

test('matches a quote to the saved preset details', () => {
  const preset = {
    fromCurrency: exchange.fromCurrency,
    fromNetwork: exchange.fromNetwork,
    toCurrency: exchange.toCurrency,
    toNetwork: exchange.toNetwork,
    fromAmount: exchange.fromAmount,
    destinationAddress: exchange.toAddress,
    destinationExtraId: exchange.toExtraId,
    refundAddress: exchange.refundAddress,
    refundExtraId: exchange.refundExtraId,
  }

  assert.equal(quoteMatchesPreset(preset, exchange), true)
  assert.equal(quoteMatchesPreset({ ...preset, destinationAddress: 'other-address' }, exchange), false)
  assert.equal(quoteMatchesPreset({ ...preset, fromAmount: '0.5' }, exchange), false)
})

test('expires quotes at and after their expiry timestamp', () => {
  assert.equal(quoteExpired(60000, 59999), false)
  assert.equal(quoteExpired(60000, 60000), true)
  assert.equal(quoteExpired(undefined, 0), true)
})