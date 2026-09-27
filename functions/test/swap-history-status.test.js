const assert = require('node:assert/strict')
const test = require('node:test')
const { depositReceived, pendingHistoryStatus, isWaitingForDeposit } = require('../swap-history-status')

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