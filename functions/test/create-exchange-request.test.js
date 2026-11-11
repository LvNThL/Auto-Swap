const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCreateExchangeBody, getLimitEstimateAmount } = require('../create-exchange-request')

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

test('converts the percentage to an exact target amount in the create request', () => {
  const body = buildCreateExchangeBody(
    { ...exchange, flow: 'standard', limitEstimate: '99.5' },
    '0x-destination',
    { estimatedAmount: '1.5644974' },
  )

  assert.equal(body.limitEstimate, '1.556674913')
  assert.equal(body.address, '0x-destination')
  assert.equal(body.flow, 'standard')
  assert.equal('rateId' in body, false)
})

test('calculates exact limits for integer percentages and scientific-notation estimates', () => {
  assert.equal(getLimitEstimateAmount('1.5644974', '97'), '1.517562478')
  assert.equal(getLimitEstimateAmount('1.5644974', '100'), '1.5644974')
  assert.equal(getLimitEstimateAmount('1.5644974', '150'), '2.3467461')
  assert.equal(getLimitEstimateAmount('1e-7', '100'), '0.0000001')
})

test('omits a blank minimum payout from the create request', () => {
  const body = buildCreateExchangeBody(
    { ...exchange, flow: 'standard', limitEstimate: '' },
    '0x-destination',
    { estimatedAmount: '1.5644974' },
  )

  assert.equal('limitEstimate' in body, false)
})

test('keeps fixed-rate identifiers and omits the standard-rate minimum payout', () => {
  const body = buildCreateExchangeBody(
    { ...exchange, flow: 'fixed-rate', limitEstimate: '' },
    '0x-destination',
    { rateId: 'rate-123', estimatedAmount: '1.5644974' },
  )

  assert.equal(body.rateId, 'rate-123')
  assert.equal('limitEstimate' in body, false)
})
