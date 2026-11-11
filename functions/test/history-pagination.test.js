const assert = require('node:assert/strict')
const test = require('node:test')
const {
  HISTORY_PAGE_SIZE,
  normalizeHistoryCursor,
  pageHistorySnapshot,
} = require('../history-pagination')

function historyDocument(id, createdAt) {
  return {
    id,
    get: (field) => field === 'createdAt' ? { toMillis: () => createdAt } : undefined,
  }
}

test('history cursor validation preserves a valid timestamp and document ID', () => {
  assert.deepEqual(normalizeHistoryCursor({ createdAt: 1234, id: 'swap-id' }), {
    createdAt: 1234,
    id: 'swap-id',
  })
  assert.equal(normalizeHistoryCursor(undefined), null)
  assert.throws(() => normalizeHistoryCursor({ createdAt: '1234', id: 'swap-id' }), /cursor/)
  assert.throws(() => normalizeHistoryCursor({ createdAt: 1234, id: '' }), /cursor/)
  assert.throws(() => normalizeHistoryCursor({ createdAt: Number.MAX_SAFE_INTEGER, id: 'swap-id' }), /cursor/)
})

test('history pages return a stable cursor only when another page exists', () => {
  const snapshot = {
    docs: Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, index) =>
      historyDocument(`swap-${index}`, 1000 - index)),
  }

  const page = pageHistorySnapshot(snapshot)
  assert.equal(page.documents.length, HISTORY_PAGE_SIZE)
  assert.equal(page.hasMore, true)
  assert.deepEqual(page.nextCursor, { createdAt: 951, id: 'swap-49' })

  const finalPage = pageHistorySnapshot({ docs: snapshot.docs.slice(0, 1) })
  assert.equal(finalPage.hasMore, false)
  assert.equal(finalPage.nextCursor, null)
})
