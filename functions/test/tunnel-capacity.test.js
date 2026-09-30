const assert = require('node:assert/strict')
const test = require('node:test')
const {
  MAX_OPEN_TUNNELS_PER_USER,
  collectActiveTunnelIds,
  reserveTunnelId,
  isConfirmedCreateFailure,
} = require('../tunnel-capacity')

test('reserves the first three provider-live tunnel slots and rejects a fourth', () => {
  assert.equal(MAX_OPEN_TUNNELS_PER_USER, 3)
  const first = reserveTunnelId([], 'quote-1')
  const second = reserveTunnelId(first, 'quote-2')
  const third = reserveTunnelId(second, 'quote-3')

  assert.deepEqual(third, ['quote-1', 'quote-2', 'quote-3'])
  assert.equal(reserveTunnelId(third, 'quote-4'), null)
})

test('keeps locally closed waiting tunnels reserved but ignores provider-confirmed terminal records', () => {
  const activeIds = collectActiveTunnelIds(
    ['reserved-1'],
    [
      { id: 'waiting-2', status: 'waiting' },
      { id: 'expired-3', status: 'expired' },
      { id: 'released-4', providerLiveTunnel: false, status: 'waiting' },
    ],
    [
      { id: 'closed-5', status: 'cancelled', cancellationReason: 'user-requested' },
      { id: 'closed-6', status: 'cancelled', cancellationReason: 'access-window-ended', providerLiveTunnel: false },
    ],
  )

  assert.deepEqual(activeIds, ['reserved-1', 'waiting-2', 'closed-5'])
})

test('deduplicates reservations against their pending provider record', () => {
  assert.deepEqual(
    collectActiveTunnelIds(['quote-1'], [{ id: 'quote-1', status: 'waiting' }], []),
    ['quote-1'],
  )
})

test('releases a reservation only for a confirmed provider rejection', () => {
  assert.equal(isConfirmedCreateFailure({ code: 'failed-precondition' }), true)
  assert.equal(isConfirmedCreateFailure({ code: 'invalid-argument' }), true)
  assert.equal(isConfirmedCreateFailure({ code: 'unavailable' }), false)
  assert.equal(isConfirmedCreateFailure(new TypeError('Network timeout')), false)
})