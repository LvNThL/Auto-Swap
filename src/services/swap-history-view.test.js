import test from 'node:test'
import assert from 'node:assert/strict'
import { filterSwapHistoryRecords, mergeSwapHistoryRecords } from './swap-history-view.js'

test('history pages merge without duplicates and stay newest-first', () => {
  const merged = mergeSwapHistoryRecords(
    [{ id: 'older', createdAt: 100 }, { id: 'newer', createdAt: 200, status: 'waiting' }],
    [{ id: 'newer', createdAt: 200, status: 'finished' }, { id: 'oldest', createdAt: 50 }],
  )

  assert.deepEqual(merged.map(({ id }) => id), ['newer', 'older', 'oldest'])
  assert.equal(merged[0].status, 'finished')
})

test('all current history keeps records with statuses the UI does not recognize', () => {
  const swaps = [
    { id: 'known', status: 'finished' },
    { id: 'unknown', status: 'provider-review' },
  ]

  assert.deepEqual(filterSwapHistoryRecords(swaps, 'all'), swaps)
})

test('history filters classify provider-expired, failed, and refunded records', () => {
  const swaps = [
    { id: 'local-close', status: 'cancelled', cancellationReason: 'user-requested' },
    { id: 'expired', status: 'cancelled', cancellationReason: 'provider-expired' },
    { id: 'failed', status: 'failed' },
    { id: 'refunded', status: 'refunded' },
  ]

  assert.deepEqual(filterSwapHistoryRecords(swaps, 'cancelled').map(({ id }) => id), ['local-close'])
  assert.deepEqual(filterSwapHistoryRecords(swaps, 'expired').map(({ id }) => id), ['expired'])
  assert.deepEqual(filterSwapHistoryRecords(swaps, 'failed').map(({ id }) => id), ['failed', 'refunded'])
})
