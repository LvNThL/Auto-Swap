const inProgressOrCompletedStatuses = new Set(['waiting', 'confirming', 'exchanging', 'sending', 'finished'])

export function mergeSwapHistoryRecords(...groups) {
  const recordsById = new Map()
  for (const swap of groups.flat()) {
    const id = swap.id ?? swap.exchangeId
    if (typeof id !== 'string' || !id) continue
    recordsById.set(id, { ...recordsById.get(id), ...swap })
  }
  return [...recordsById.values()]
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
}

export function filterSwapHistoryRecords(swaps, filter, openTunnelIds = new Set()) {
  return swaps.filter((swap) => {
    if (swap.trackingNeedsAttention) return true
    if ((swap.id && openTunnelIds.has(swap.id)) || (swap.exchangeId && openTunnelIds.has(swap.exchangeId))) return true

    const status = String(swap.status || '').toLowerCase()
    if (filter === 'in-progress-completed') return inProgressOrCompletedStatuses.has(status)
    if (filter === 'cancelled') return status === 'cancelled' && swap.cancellationReason !== 'provider-expired'
    if (filter === 'expired') return status === 'expired' || swap.cancellationReason === 'provider-expired'
    if (filter === 'failed') return status === 'failed' || status === 'refunded'
    return true
  })
}
