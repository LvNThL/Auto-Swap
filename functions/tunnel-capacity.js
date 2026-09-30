const MAX_WAITING_TUNNELS_PER_USER = 3

function isWaitingRecord(record) {
  return String(record.status ?? 'waiting').toLowerCase() === 'waiting'
}

function collectWaitingTunnelIds(reservedIds, pendingRecords, reservationRecords) {
  const pendingById = new Map(pendingRecords.map((record) => [record.id, record]))
  const reservationById = new Map(reservationRecords.map((record) => [record.id, record]))
  const waitingIds = new Set()

  for (const record of pendingRecords) {
    if (typeof record.id === 'string' && isWaitingRecord(record)) waitingIds.add(record.id)
  }

  for (const id of reservedIds) {
    if (typeof id !== 'string' || waitingIds.has(id) || pendingById.has(id)) continue
    const record = reservationById.get(id)
    if (!record?.exists) continue
    if (record.trackingStatus === 'pending') {
      if (isWaitingRecord(record)) waitingIds.add(id)
    } else if (record.consumedAt) {
      waitingIds.add(id)
    }
  }

  return [...waitingIds]
}

function reserveTunnelId(activeIds, quoteId) {
  if (activeIds.includes(quoteId)) return activeIds
  if (activeIds.length >= MAX_WAITING_TUNNELS_PER_USER) return null
  return [...activeIds, quoteId]
}

function isConfirmedCreateFailure(error) {
  return error?.code === 'failed-precondition' || error?.code === 'invalid-argument'
}

module.exports = {
  MAX_WAITING_TUNNELS_PER_USER,
  collectWaitingTunnelIds,
  reserveTunnelId,
  isConfirmedCreateFailure,
}