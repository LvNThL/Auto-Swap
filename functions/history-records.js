function isTerminalHistoryStatus(status) {
  return ['finished', 'failed', 'refunded', 'expired', 'cancelled'].includes(
    String(status ?? '').toLowerCase(),
  )
}

module.exports = {
  isTerminalHistoryStatus,
}
