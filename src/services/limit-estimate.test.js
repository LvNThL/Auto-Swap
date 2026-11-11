import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidLimitEstimate } from './limit-estimate.js'

test('accepts blank, boundary, and in-range decimal minimum payouts', () => {
  for (const value of ['', '97', '97.0000000000000001', '99.5', '100', '150']) {
    assert.equal(isValidLimitEstimate(value), true, value)
  }
})

test('rejects malformed or out-of-range minimum payouts using exact decimal bounds', () => {
  for (const value of [' ', '0', '-1', '1e2', '99%', '96.9999999999999999', '150.0000000000000001', 99]) {
    assert.equal(isValidLimitEstimate(value), false, String(value))
  }
})
