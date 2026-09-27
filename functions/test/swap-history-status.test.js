const assert = require('node:assert/strict')
const test = require('node:test')
const { depositReceived, pendingHistoryStatus } = require('../swap-history-status')

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