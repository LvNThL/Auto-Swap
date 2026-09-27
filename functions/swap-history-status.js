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

module.exports = { depositReceived, pendingHistoryStatus }