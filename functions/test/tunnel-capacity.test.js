const assert = require('node:assert/strict')
const test = require('node:test')
const {
  MAX_WAITING_TUNNELS_PER_USER,
  collectWaitingTunnelIds,
  reserveTunnelId,
  isConfirmedCreateFailure,
} = require('../tunnel-capacity')

test('reserves three locally waiting tunnel slots and rejects a fourth', () => {
  assert.equal(MAX_WAITING_TUNNELS_PER_USER, 3)
  const first = reserveTunnelId([], 'quote-1')
  const second = reserveTunnelId(first, 'quote-2')
  const third = reserveTunnelId(second, 'quote-3')

  assert.deepEqual(third, ['quote-1', 'quote-2', 'quote-3'])
  assert.equal(reserveTunnelId(third, 'quote-4'), null)
})

test('counts locally waiting pending records but not progressed or closed records', () => {
  const waitingIds = collectWaitingTunnelIds(
    [],
    [
      { id: 'waiting-1', status: 'waiting' },
      { id: 'progressed-2', status: 'confirming' },
    ],
    [],
  )

  assert.deepEqual(waitingIds, ['waiting-1'])
})

test('drops stale reservations and retains only unresolved or locally waiting reservations', () => {
  const waitingIds = collectWaitingTunnelIds(
    ['closed-1', 'creating-2', 'progressed-3', 'waiting-4'],
    [{ id: 'waiting-4', status: 'waiting' }],
    [
      { id: 'closed-1', exists: false },
      { id: 'creating-2', exists: true, consumedAt: 123 },
      { id: 'progressed-3', exists: true, consumedAt: 123, trackingStatus: 'pending', status: 'confirming' },
      { id: 'waiting-4', exists: true, consumedAt: 123, trackingStatus: 'pending', status: 'waiting' },
    ],
  )

  assert.deepEqual(waitingIds, ['waiting-4', 'creating-2'])
})

test('deduplicates reservations against their pending provider record', () => {
  assert.deepEqual(
    collectWaitingTunnelIds(
      ['quote-1'],
      [{ id: 'quote-1', status: 'waiting' }],
      [{ id: 'quote-1', exists: true, consumedAt: 123, trackingStatus: 'pending', status: 'waiting' }],
    ),
    ['quote-1'],
  )
})

test('releases a reservation only for a confirmed provider rejection', () => {
  assert.equal(isConfirmedCreateFailure({ code: 'failed-precondition' }), true)
  assert.equal(isConfirmedCreateFailure({ code: 'invalid-argument' }), true)
  assert.equal(isConfirmedCreateFailure({ code: 'unavailable' }), false)
  assert.equal(isConfirmedCreateFailure(new TypeError('Network timeout')), false)
})