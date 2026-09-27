const assert = require('node:assert/strict')
const test = require('node:test')
const { extractTransactionHistoryDetails, networkExplorerUrl } = require('../transaction-history-details')

test('extracts ChangeNOW network fee and deposit and payout explorer links', () => {
  assert.deepEqual(extractTransactionHistoryDetails({
    networkFee: '0.0004',
    networkFeeCurrency: 'ETH',
    payinHash: '0xdeposit',
    payoutHash: '0xpayout',
  }, { fromNetwork: 'eth', toNetwork: 'bsc' }), {
    networkFee: '0.0004',
    networkFeeCurrency: 'eth',
    payinHash: '0xdeposit',
    payinExplorerUrl: 'https://etherscan.io/tx/0xdeposit',
    payoutHash: '0xpayout',
    payoutExplorerUrl: 'https://bscscan.com/tx/0xpayout',
  })
})

test('accepts a structured fee and safely omits invalid or unsupported transaction data', () => {
  assert.deepEqual(extractTransactionHistoryDetails({
    networkFee: { amount: 0, currency: 'BTC' },
    payinHash: 'bad/hash',
    payoutHash: 'abc123',
  }, { fromNetwork: 'unknown-network', toNetwork: 'unknown-network' }), {
    networkFee: '0',
    networkFeeCurrency: 'btc',
    payoutHash: 'abc123',
    payoutExplorerUrl: null,
  })
  assert.equal(networkExplorerUrl('eth', '0xabc'), 'https://etherscan.io/tx/0xabc')
  assert.equal(networkExplorerUrl('unknown-network', '0xabc'), null)
  assert.equal(networkExplorerUrl('eth', 'javascript:alert(1)'), null)
})