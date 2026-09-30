const MAX_OPEN_TUNNELS_PER_USER = 3
const LOCAL_CLOSE_REASONS = new Set(['user-requested', 'access-window-ended'])
const NON_LIVE_STATUSES = new Set([
  'confirming',
  'exchanging',
  'sending',
  'finished',
  'failed',
  'refunded',
  'expired',
  'cancelled',
])

function isProviderLiveTunnel(record) {
  if (record.providerLiveTunnel === false) return false
  if (LOCAL_CLOSE_REASONS.has(record.cancellationReason)) return true
  return !NON_LIVE_STATUSES.has(String(record.status ?? '').toLowerCase())
}

function collectActiveTunnelIds(reservedIds, pendingRecords, locallyClosedRecords) {
  const activeIds = new Set(reservedIds.filter((id) => typeof id === 'string'))
  for (const record of [...pendingRecords, ...locallyClosedRecords]) {
    if (typeof record.id === 'string' && isProviderLiveTunnel(record)) activeIds.add(record.id)
  }
  return [...activeIds]
}

function reserveTunnelId(activeIds, quoteId) {
  if (activeIds.includes(quoteId)) return activeIds
  if (activeIds.length >= MAX_OPEN_TUNNELS_PER_USER) return null
  return [...activeIds, quoteId]
}

function isConfirmedCreateFailure(error) {
  return error?.code === 'failed-precondition' || error?.code === 'invalid-argument'
}

module.exports = {
  MAX_OPEN_TUNNELS_PER_USER,
  collectActiveTunnelIds,
  reserveTunnelId,
  isConfirmedCreateFailure,
}