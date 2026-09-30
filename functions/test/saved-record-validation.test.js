const assert = require('node:assert/strict')
const test = require('node:test')
const {
  MAX_PRESETS_PER_USER,
  MAX_ADDRESS_BOOK_ENTRIES_PER_USER,
  MAX_DAILY_SAVED_RECORD_WRITES,
  validatePreset,
  validateAddressBookEntry,
} = require('../saved-record-validation')

const validPreset = {
  name: 'FIL to USDT',
  fromCurrency: 'FIL',
  fromNetwork: 'FIL',
  toCurrency: 'USDT',
  toNetwork: 'BSC',
  fromAmount: '10',
  destinationAddress: '0xabc123',
  destinationExtraId: '',
  refundAddress: '',
  refundExtraId: '',
}

const validAddress = {
  label: 'Main wallet',
  address: 'address-value',
  extraId: '',
  ticker: 'FIL',
  network: 'FIL',
  purpose: 'destination',
}

test('defines conservative per-user and project-wide record quotas', () => {
  assert.equal(MAX_PRESETS_PER_USER, 25)
  assert.equal(MAX_ADDRESS_BOOK_ENTRIES_PER_USER, 50)
  assert.equal(MAX_DAILY_SAVED_RECORD_WRITES, 250)
})

test('trims preset text and canonicalizes currency/network identifiers', () => {
  assert.deepEqual(validatePreset(validPreset), {
    ...validPreset,
    name: 'FIL (FIL) to USDT (BSC)',
    fromCurrency: 'fil',
    fromNetwork: 'fil',
    toCurrency: 'usdt',
    toNetwork: 'bsc',
  })
})

test('generates preset names from the selected assets and ignores custom labels', () => {
  assert.equal(validatePreset({ ...validPreset, name: 'Personal label' }).name, 'FIL (FIL) to USDT (BSC)')
  assert.equal(validatePreset({ ...validPreset, name: '' }).name, 'FIL (FIL) to USDT (BSC)')
  assert.equal(validatePreset({
    ...validPreset,
    fromCurrency: 'USDT',
    fromNetwork: 'BSC',
    toCurrency: 'USDT',
    toNetwork: 'ETH',
  }).name, 'USDT (BSC) to USDT (ETH)')
})

test('rejects preset fields that are not part of the stored schema', () => {
  assert.throws(() => validatePreset({ ...validPreset, arbitrary: 'payload' }), /unsupported fields/)
  assert.throws(() => validatePreset({ ...validPreset, sourceName: 'My wallet app' }), /unsupported fields/)
  assert.throws(() => validatePreset({ ...validPreset, destinationName: 'My destination app' }), /unsupported fields/)
})

test('rejects invalid, zero, and non-decimal preset amounts', () => {
  for (const fromAmount of ['0', '-1', '1e6', 'not-a-number']) {
    assert.throws(() => validatePreset({ ...validPreset, fromAmount }), /fromAmount/)
  }
})

test('rejects oversized preset addresses and missing required fields', () => {
  assert.throws(() => validatePreset({ ...validPreset, destinationAddress: 'x'.repeat(257) }), /destinationAddress/)
  assert.throws(() => validatePreset({ ...validPreset, destinationAddress: '' }), /destinationAddress/)
})

test('normalizes valid address-book entries and rejects invalid purpose or extra fields', () => {
  assert.deepEqual(validateAddressBookEntry(validAddress), { ...validAddress, ticker: 'fil', network: 'fil' })
  assert.throws(() => validateAddressBookEntry({ ...validAddress, purpose: 'deposit' }), /purpose/)
  assert.throws(() => validateAddressBookEntry({ ...validAddress, unexpected: true }), /unsupported fields/)
})

test('rejects oversized address-book entries', () => {
  assert.throws(() => validateAddressBookEntry({ ...validAddress, address: 'x'.repeat(257) }), /address/)
})
