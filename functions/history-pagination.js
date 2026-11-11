const HISTORY_PAGE_SIZE = 50

function normalizeHistoryCursor(cursor) {
  if (cursor == null) return null
  if (typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new TypeError('Invalid swap history cursor.')
  }
  if (!Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0 || cursor.createdAt > 253402300799999
    || typeof cursor.id !== 'string' || cursor.id.length === 0 || cursor.id.length > 1500) {
    throw new TypeError('Invalid swap history cursor.')
  }
  return { createdAt: cursor.createdAt, id: cursor.id }
}

function pageHistorySnapshot(snapshot, pageSize = HISTORY_PAGE_SIZE) {
  const documents = snapshot.docs.slice(0, pageSize)
  const hasMore = snapshot.docs.length > pageSize
  const lastDocument = documents[documents.length - 1]
  if (!hasMore || !lastDocument) return { documents, hasMore, nextCursor: null }

  const createdAt = lastDocument.get('createdAt')
  if (typeof createdAt?.toMillis !== 'function') {
    throw new Error('Swap history page is missing a timestamp cursor.')
  }

  return {
    documents,
    hasMore,
    nextCursor: { createdAt: createdAt.toMillis(), id: lastDocument.id },
  }
}

module.exports = {
  HISTORY_PAGE_SIZE,
  normalizeHistoryCursor,
  pageHistorySnapshot,
}
