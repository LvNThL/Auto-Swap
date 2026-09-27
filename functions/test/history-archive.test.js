const assert = require('node:assert/strict')
const test = require('node:test')
const {
  historyArchiveMonth,
  historyArchivePath,
  historyRecordsToCsv,
  mergeArchiveRecords,
  defaultStorageBucketName,
  serializeSwapHistoryRecord,
} = require('../history-archive')

test('serializes tax history without dropping timestamps or explorer data', () => {
  const createdAt = { toMillis: () => Date.UTC(2026, 7, 12) }
  assert.deepEqual(serializeSwapHistoryRecord('record1', {
    exchangeId: 'exchange1',
    fromCurrency: 'btc',
    fromNetwork: 'btc',
    fromAmount: '0.5',
    toCurrency: 'eth',
    toNetwork: 'eth',
    toAmount: '8.2',
    payinHash: 'deposit-hash',
    payinExplorerUrl: 'https://example.com/deposit-hash',
    status: 'finished',
    createdAt,
  }), {
    id: 'record1',
    exchangeId: 'exchange1',
    fromCurrency: 'btc',
    fromNetwork: 'btc',
    fromAmount: '0.5',
    toCurrency: 'eth',
    toNetwork: 'eth',
    toAmount: '8.2',
    payinHash: 'deposit-hash',
    payoutHash: null,
    payinExplorerUrl: 'https://example.com/deposit-hash',
    payoutExplorerUrl: null,
    status: 'finished',
    cancellationReason: null,
    createdAt: Date.UTC(2026, 7, 12),
    updatedAt: null,
  })
})

test('groups archives by UTC month and uses an account-scoped object path', () => {
  assert.equal(historyArchiveMonth(Date.UTC(2026, 0, 31, 23, 59)), '2026-01')
  assert.equal(historyArchiveMonth(Date.UTC(2026, 1, 1)), '2026-02')
  assert.equal(historyArchiveMonth(Number.NaN), null)
  assert.equal(historyArchivePath('user123', '2026-02'), 'users/user123/swap-history-archive/2026-02.json')
})

test('resolves the configured bucket or the Firebase default bucket name', () => {
  assert.equal(defaultStorageBucketName({ storageBucket: 'custom.example.net' }), 'custom.example.net')
  assert.equal(defaultStorageBucketName({ projectId: 'auto-swap-4d4b6' }), 'auto-swap-4d4b6.firebasestorage.app')
  assert.equal(defaultStorageBucketName({}), null)
})

test('merges archive retries without duplicating executions', () => {
  assert.deepEqual(mergeArchiveRecords(
    [{ id: 'older', createdAt: 1 }, { id: 'same', createdAt: 2 }],
    [{ id: 'same', createdAt: 2, status: 'finished' }, { id: 'newer', createdAt: 3 }],
  ), [
    { id: 'older', createdAt: 1 },
    { id: 'same', createdAt: 2, status: 'finished' },
    { id: 'newer', createdAt: 3 },
  ])
})

test('creates spreadsheet-safe CSV with tax-relevant transaction fields', () => {
  const csv = historyRecordsToCsv([{
    createdAt: Date.UTC(2026, 0, 2),
    status: 'finished',
    exchangeId: '=IMPORTXML("unsafe")',
    fromAmount: '0.25',
    fromCurrency: 'btc',
    fromNetwork: 'btc',
    toAmount: '4.5',
    toCurrency: 'eth',
    toNetwork: 'eth',
    payinHash: 'deposit-hash',
    payoutHash: 'payout-hash',
    cancellationReason: 'user-requested',
  }])

  assert.match(csv, /^"Date","Status","Exchange ID"/)
  assert.match(csv, /"'=?IMPORTXML\(""unsafe""\)"/)
  assert.match(csv, /"2026-01-02T00:00:00\.000Z"/)
  assert.match(csv, /"deposit-hash","payout-hash","user-requested"$/)
})