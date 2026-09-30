const CSV_COLUMNS = [
  ['Opened At', 'createdAt'],
  ['Last Status Update', 'updatedAt'],
  ['Status', 'status'],
  ['Exchange ID', 'exchangeId'],
  ['Sent Amount', 'fromAmount'],
  ['Sent Asset', 'fromCurrency'],
  ['Sent Network', 'fromNetwork'],
  ['Received Amount', 'toAmount'],
  ['Received Asset', 'toCurrency'],
  ['Received Network', 'toNetwork'],
  ['Deposit Transaction Hash', 'payinHash'],
  ['Payout Transaction Hash', 'payoutHash'],
  ['Closure Reason', 'cancellationReason'],
]

function timestampMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : value ?? null
}

function serializeSwapHistoryRecord(id, record) {
  return {
    id,
    exchangeId: record.exchangeId ?? null,
    fromCurrency: record.fromCurrency,
    fromNetwork: record.fromNetwork,
    fromAmount: record.fromAmount,
    toCurrency: record.toCurrency,
    toNetwork: record.toNetwork,
    toAmount: record.toAmount ?? null,
    payinHash: record.payinHash ?? null,
    payoutHash: record.payoutHash ?? null,
    payinExplorerUrl: record.payinExplorerUrl ?? null,
    payoutExplorerUrl: record.payoutExplorerUrl ?? null,
    status: record.status ?? 'unknown',
    cancellationReason: record.cancellationReason ?? null,
    createdAt: timestampMillis(record.createdAt),
    updatedAt: timestampMillis(record.updatedAt),
  }
}

function historyArchiveMonth(createdAt) {
  if (!Number.isFinite(createdAt)) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function historyArchivePath(userId, month) {
  return `users/${userId}/swap-history-archive/${month}.json`
}

function defaultStorageBucketName({ storageBucket, projectId } = {}) {
  if (typeof storageBucket === 'string' && storageBucket.trim()) return storageBucket.trim()
  if (typeof projectId === 'string' && projectId.trim()) return `${projectId.trim()}.firebasestorage.app`
  return null
}

function mergeArchiveRecords(existingRecords, newRecords) {
  const recordsById = new Map()
  for (const record of [...existingRecords, ...newRecords]) {
    if (typeof record?.id === 'string' && record.id) recordsById.set(record.id, record)
  }
  return [...recordsById.values()].sort((left, right) =>
    (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.id.localeCompare(right.id))
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

function historyRecordsToCsv(records) {
  const header = CSV_COLUMNS.map(([label]) => csvCell(label)).join(',')
  const rows = records.map((record) => CSV_COLUMNS.map(([, field]) => {
    const value = ['createdAt', 'updatedAt'].includes(field) && Number.isFinite(record[field])
      ? new Date(record[field]).toISOString()
      : record[field]
    return csvCell(value)
  }).join(','))
  return [header, ...rows].join('\r\n')
}

module.exports = {
  historyArchiveMonth,
  historyArchivePath,
  historyRecordsToCsv,
  mergeArchiveRecords,
  defaultStorageBucketName,
  serializeSwapHistoryRecord,
}