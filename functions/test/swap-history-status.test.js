const assert = require('node:assert/strict')
const test = require('node:test')
const {
  depositReceived,
  pendingHistoryStatus,
  isWaitingForDeposit,
  isLocallyClosedSwap,
  isArchivableSwapHistoryRecord,
  shouldMonitorProviderStatus,
  tunnelAccessExpiresAt,
  isTunnelAccessWindowOpen,
} = require('../swap-history-status')

test('only treats statuses after deposit detection as history-worthy', () => {
  for (const status of ['confirming', 'exchanging', 'sending', 'finished', 'failed', 'refunded']) {
    assert.equal(depositReceived(status), true, status)
  }

  for (const status of ['waiting', 'expired', 'unknown', null]) {
    assert.equal(depositReceived(status), false, String(status))
  }
})

test('marks a pre-deposit tunnel as cancelled when ChangeNOW reports expiration', () => {
  assert.equal(pendingHistoryStatus('expired'), 'cancelled')
  assert.equal(pendingHistoryStatus('waiting'), 'waiting')
  assert.equal(pendingHistoryStatus('finished'), 'finished')
})

test('only allows manual closeout while ChangeNOW reports waiting for a deposit', () => {
  assert.equal(isWaitingForDeposit('waiting'), true)
  assert.equal(isWaitingForDeposit('WAITING'), true)
  for (const status of ['confirming', 'exchanging', 'expired', 'unknown', null]) {
    assert.equal(isWaitingForDeposit(status), false, String(status))
  }
})

test('keeps AutoSwap-closed swaps eligible for later provider status checks', () => {
  assert.equal(isLocallyClosedSwap({ status: 'cancelled', cancellationReason: 'user-requested' }), true)
  assert.equal(isLocallyClosedSwap({ status: 'cancelled', cancellationReason: 'access-window-ended' }), true)
  assert.equal(isLocallyClosedSwap({ status: 'cancelled', cancellationReason: 'provider-expired' }), false)
  assert.equal(isLocallyClosedSwap({ status: 'waiting', cancellationReason: 'access-window-ended' }), false)
})

test('uses the stored access deadline and falls back to tunnel-open time', () => {
  const record = {
    tunnelOpenedAt: { toMillis: () => 60_000 },
    tunnelAccessExpiresAt: { toMillis: () => 480_000 },
  }
  assert.equal(tunnelAccessExpiresAt(record, 420_000), 480_000)
  assert.equal(isTunnelAccessWindowOpen(record, 479_999, 420_000), true)
  assert.equal(isTunnelAccessWindowOpen(record, 480_000, 420_000), false)
  assert.equal(tunnelAccessExpiresAt({ createdAt: 60_000 }, 420_000), 480_000)
})

test('does not archive locally closed tunnels while the provider tunnel remains live', () => {
  assert.equal(isArchivableSwapHistoryRecord({ status: 'cancelled', providerLiveTunnel: true }), false)
  assert.equal(isArchivableSwapHistoryRecord({ status: 'cancelled', providerLiveTunnel: false }), true)
  assert.equal(isArchivableSwapHistoryRecord({ status: 'finished', providerLiveTunnel: true }), false)
  assert.equal(isArchivableSwapHistoryRecord({ status: 'waiting', providerLiveTunnel: false }), false)
})

test('keeps provider monitoring active through processing and stops at terminal statuses', () => {
  for (const status of ['waiting', 'confirming', 'exchanging', 'sending', 'unknown']) {
    assert.equal(shouldMonitorProviderStatus(status), true, status)
  }
  for (const status of ['finished', 'failed', 'refunded', 'expired', 'cancelled']) {
    assert.equal(shouldMonitorProviderStatus(status), false, status)
  }
})