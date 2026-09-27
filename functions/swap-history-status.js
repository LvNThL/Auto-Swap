const DEPOSIT_RECEIVED_STATUSES = new Set([
  'confirming',
  'exchanging',
  'sending',
  'finished',
  'failed',
  'refunded',
])

function depositReceived(status) {
  return typeof status === 'string' && DEPOSIT_RECEIVED_STATUSES.has(status.toLowerCase())
}

function pendingHistoryStatus(status) {
  return typeof status === 'string' && status.toLowerCase() === 'expired' ? 'cancelled' : status
}

function isWaitingForDeposit(status) {
  return typeof status === 'string' && status.toLowerCase() === 'waiting'
}

module.exports = { depositReceived, pendingHistoryStatus, isWaitingForDeposit }