const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCreateExchangeBody } = require('../create-exchange-request')

const exchange = {
  fromCurrency: 'btc',
  fromNetwork: 'btc',
  toCurrency: 'eth',
  toNetwork: 'eth',
  fromAmount: '0.1',
  toExtraId: '',
  refundAddress: '',
  refundExtraId: '',
}

test('forwards a standard-rate minimum payout unchanged in the create request', () => {
  const body = buildCreateExchangeBody(
    { ...exchange, flow: 'standard', limitEstimate: '99.5' },
    '0x-destination',
    {},
  )

  assert.equal(body.limitEstimate, '99.5')
  assert.equal(body.address, '0x-destination')
  assert.equal(body.flow, 'standard')
  assert.equal('rateId' in body, false)
})

test('omits a blank minimum payout from the create request', () => {
  const body = buildCreateExchangeBody(
    { ...exchange, flow: 'standard', limitEstimate: '' },
    '0x-destination',
    {},
  )

  assert.equal('limitEstimate' in body, false)
})

test('keeps fixed-rate identifiers and omits the standard-rate minimum payout', () => {
  const body = buildCreateExchangeBody(
    { ...exchange, flow: 'fixed-rate', limitEstimate: '' },
    '0x-destination',
    { rateId: 'rate-123' },
  )

  assert.equal(body.rateId, 'rate-123')
  assert.equal('limitEstimate' in body, false)
})
