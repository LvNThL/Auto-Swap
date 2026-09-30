const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCurrencyCatalog } = require('../currency-catalog')

test('normalizes crypto assets and filters fiat and malformed records', () => {
  const currencies = normalizeCurrencyCatalog([
    { ticker: 'ETH', name: 'Ethereum', network: 'ETH', image: '/eth.svg', featured: true, buy: true, sell: true },
    { ticker: 'XRP', name: 'XRP', network: 'xrp', hasExternalId: true, isExtraIdSupported: true, buy: true, sell: true },
    { ticker: 'SOURCE', name: 'Source Only', network: 'src', buy: false, sell: true },
    { ticker: 'USD', name: 'US Dollar', network: 'usd', isFiat: true },
    { ticker: '', name: 'Invalid', network: 'test' },
  ])

  assert.deepEqual(currencies, [
    {
      id: 'eth:eth',
      ticker: 'eth',
      network: 'eth',
      name: 'Ethereum',
      canBuy: true,
      canSell: true,
      image: '/eth.svg',
      featured: true,
      tokenContract: null,
      hasExternalId: false,
      requiresExtraId: false,
      supportsExtraId: false,
    },
    {
      id: 'source:src',
      ticker: 'source',
      network: 'src',
      name: 'Source Only',
      canBuy: false,
      canSell: true,
      image: '',
      featured: false,
      tokenContract: null,
      hasExternalId: false,
      requiresExtraId: false,
      supportsExtraId: false,
    },
    {
      id: 'xrp:xrp',
      ticker: 'xrp',
      network: 'xrp',
      name: 'XRP',
      canBuy: true,
      canSell: true,
      image: '',
      featured: false,
      tokenContract: null,
      hasExternalId: true,
      requiresExtraId: true,
      supportsExtraId: true,
    },
  ])
})

test('distinguishes required extra IDs from optional extra-ID support', () => {
  const currencies = normalizeCurrencyCatalog([
    { ticker: 'xrp', name: 'Ripple', network: 'xrp', hasExternalId: true, isExtraIdSupported: true, buy: true, sell: true },
    { ticker: 'usdt', name: 'Tether USD (TON)', network: 'ton', hasExternalId: false, isExtraIdSupported: true, buy: true, sell: true },
    { ticker: 'neiroeth', name: 'Neiro Ethereum', network: 'eth', hasExternalId: true, isExtraIdSupported: false, buy: true, sell: true },
  ])

  assert.deepEqual(currencies.map(({ ticker, hasExternalId, requiresExtraId, supportsExtraId }) => ({ ticker, hasExternalId, requiresExtraId, supportsExtraId })), [
    { ticker: 'neiroeth', hasExternalId: true, requiresExtraId: true, supportsExtraId: false },
    { ticker: 'xrp', hasExternalId: true, requiresExtraId: true, supportsExtraId: true },
    { ticker: 'usdt', hasExternalId: true, requiresExtraId: false, supportsExtraId: true },
  ])
})

test('preserves token contract and deduplicates ticker-network entries', () => {
  const currencies = normalizeCurrencyCatalog([
    { ticker: 'usdt', name: 'Tether', network: 'eth', tokenContract: '0xcontract', buy: true, sell: true },
    { ticker: 'usdt', name: 'Duplicate Tether', network: 'eth', tokenContract: '0xother', buy: true, sell: true },
  ])

  assert.equal(currencies.length, 1)
  assert.equal(currencies[0].tokenContract, '0xcontract')
})
