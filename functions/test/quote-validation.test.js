const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeExchangeFlow, quoteMatchesExchange, quoteMatchesPreset, quoteExpired, getQuoteExpiresAt } = require('../quote-validation')

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

test('accepts standard and fixed-rate flows and defaults to standard', () => {
  assert.equal(normalizeExchangeFlow(undefined), 'standard')
  assert.equal(normalizeExchangeFlow('standard'), 'standard')
  assert.equal(normalizeExchangeFlow('fixed-rate'), 'fixed-rate')
  assert.throws(() => normalizeExchangeFlow('unknown'), /standard or fixed-rate/)
})

test('matches the exact route and destination from the quote', () => {
  assert.equal(quoteMatchesExchange({ ...exchange }, { ...exchange }), true)
  assert.equal(quoteMatchesExchange({ ...exchange, flow: 'fixed-rate' }, { ...exchange, flow: 'fixed-rate' }), true)
  assert.equal(quoteMatchesExchange({ ...exchange }, { ...exchange, flow: 'fixed-rate' }), false)
  assert.equal(quoteMatchesExchange({ ...exchange, flow: 'fixed-rate' }, { ...exchange }), false)
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
  assert.equal(quoteMatchesPreset({ ...preset, destinationExtraId: 'legacy-tag', refundExtraId: 'legacy-refund-tag' }, {
    ...exchange,
    toExtraId: 'current-deposit-tag',
    refundExtraId: 'current-refund-tag',
  }), true)
  assert.equal(quoteMatchesPreset({ ...preset, destinationAddress: 'other-address' }, exchange), false)
  assert.equal(quoteMatchesPreset({ ...preset, fromAmount: '0.5' }, exchange), false)
})

test('binds a quote to the rate mode saved on its preset', () => {
  const preset = {
    fromCurrency: exchange.fromCurrency,
    fromNetwork: exchange.fromNetwork,
    toCurrency: exchange.toCurrency,
    toNetwork: exchange.toNetwork,
    fromAmount: exchange.fromAmount,
    destinationAddress: exchange.toAddress,
    refundAddress: exchange.refundAddress,
  }
  assert.equal(quoteMatchesPreset({ ...preset, flow: 'fixed-rate' }, { ...exchange, flow: 'fixed-rate' }), true)
  assert.equal(quoteMatchesPreset({ ...preset, flow: 'standard' }, { ...exchange, flow: 'fixed-rate' }), false)
  assert.equal(quoteMatchesPreset(preset, exchange), true)
})

test('expires quotes at and after their expiry timestamp', () => {
  assert.equal(quoteExpired(60000, 59999), false)
  assert.equal(quoteExpired(60000, 60000), true)
  assert.equal(quoteExpired(undefined, 0), true)
})

test('uses provider quote validity when supplied and falls back to the local expiry otherwise', () => {
  assert.equal(getQuoteExpiresAt(1000, 600000), 601000)
  assert.equal(getQuoteExpiresAt(1000, 600000, '1970-01-01T00:04:00.000Z'), 240000)
  assert.equal(getQuoteExpiresAt(1000, 600000, '1970-01-01T00:12:00.000Z'), 720000)
  assert.equal(getQuoteExpiresAt(1000, 600000, 240), 240000)
  assert.throws(() => getQuoteExpiresAt(1000, 600000, 'invalid'), /invalid quote expiry/)
})