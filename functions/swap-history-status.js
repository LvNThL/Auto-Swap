const DEPOSIT_RECEIVED_STATUSES = new Set([
  'confirming',
  'exchanging',
  'sending',
  'finished',
  'failed',
  'refunded',
])
const terminalSwapStatuses = new Set(['finished', 'failed', 'refunded', 'expired', 'cancelled'])

function depositReceived(status) {
  return typeof status === 'string' && DEPOSIT_RECEIVED_STATUSES.has(status.toLowerCase())
}

function pendingHistoryStatus(status) {
  return typeof status === 'string' && status.toLowerCase() === 'expired' ? 'cancelled' : status
}

function isWaitingForDeposit(status) {
  return typeof status === 'string' && status.toLowerCase() === 'waiting'
}

function isLocallyClosedSwap(record) {
  return String(record?.status ?? '').toLowerCase() === 'cancelled'
    && ['user-requested', 'access-window-ended'].includes(record?.cancellationReason)
}

function isArchivableSwapHistoryRecord(record) {
  return terminalSwapStatuses.has(String(record?.status ?? '').toLowerCase())
    && record?.providerLiveTunnel !== true
}

function shouldMonitorProviderStatus(status) {
  return !terminalSwapStatuses.has(String(status ?? '').toLowerCase())
}

function timestampMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

function tunnelAccessExpiresAt(record, ttlMs) {
  const explicitExpiry = timestampMillis(record?.tunnelAccessExpiresAt)
  if (explicitExpiry != null) return explicitExpiry
  const openedAt = timestampMillis(record?.tunnelOpenedAt) ?? timestampMillis(record?.createdAt) ?? 0
  return openedAt + ttlMs
}

function isTunnelAccessWindowOpen(record, now, ttlMs) {
  return now < tunnelAccessExpiresAt(record, ttlMs)
}

module.exports = {
  depositReceived,
  pendingHistoryStatus,
  isWaitingForDeposit,
  isLocallyClosedSwap,
  isArchivableSwapHistoryRecord,
  shouldMonitorProviderStatus,
  terminalSwapStatuses,
  tunnelAccessExpiresAt,
  isTunnelAccessWindowOpen,
}