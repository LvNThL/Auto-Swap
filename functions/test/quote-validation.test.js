const test = require('node:test')
const assert = require('node:assert/strict')
const { quoteMatchesExchange, quoteExpired } = require('../quote-validation')

const exchange = {
  fromCurrency: 'eth',
  fromNetwork: 'eth',
  toCurrency: 'btc',
  toNetwork: 'btc',
  fromAmount: '0.25',
  toAddress: 'bc1q-destination',
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
  })) {
    assert.equal(quoteMatchesExchange({ ...exchange }, { ...exchange, [field]: value }), false, field)
  }
})

test('expires quotes at and after their expiry timestamp', () => {
  assert.equal(quoteExpired(60000, 59999), false)
  assert.equal(quoteExpired(60000, 60000), true)
  assert.equal(quoteExpired(undefined, 0), true)
})