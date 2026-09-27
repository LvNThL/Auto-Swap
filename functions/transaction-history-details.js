const EXPLORER_BASES = {
  btc: 'https://blockchair.com/bitcoin/transaction/',
  bitcoin: 'https://blockchair.com/bitcoin/transaction/',
  eth: 'https://etherscan.io/tx/',
  ethereum: 'https://etherscan.io/tx/',
  bsc: 'https://bscscan.com/tx/',
  bnbbsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  matic: 'https://polygonscan.com/tx/',
  arb: 'https://arbiscan.io/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  op: 'https://optimistic.etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  trx: 'https://tronscan.org/#/transaction/',
  tron: 'https://tronscan.org/#/transaction/',
  sol: 'https://solscan.io/tx/',
  solana: 'https://solscan.io/tx/',
  ltc: 'https://blockchair.com/litecoin/transaction/',
  litecoin: 'https://blockchair.com/litecoin/transaction/',
  doge: 'https://blockchair.com/dogecoin/transaction/',
  dogecoin: 'https://blockchair.com/dogecoin/transaction/',
  xrp: 'https://xrpscan.com/tx/',
  ripple: 'https://xrpscan.com/tx/',
  xlm: 'https://stellar.expert/explorer/public/tx/',
  stellar: 'https://stellar.expert/explorer/public/tx/',
  ada: 'https://cardanoscan.io/transaction/',
  cardano: 'https://cardanoscan.io/transaction/',
  fil: 'https://filfox.info/en/message/',
  filecoin: 'https://filfox.info/en/message/',
}

function normalizeTransactionHash(value) {
  if (typeof value !== 'string') return null
  const hash = value.trim()
  return /^[A-Za-z0-9._-]{1,256}$/.test(hash) ? hash : null
}

function networkExplorerUrl(network, hash) {
  if (typeof network !== 'string' || !hash) return null
  const safeHash = normalizeTransactionHash(hash)
  if (!safeHash) return null
  const base = EXPLORER_BASES[network.trim().toLowerCase().replace(/[^a-z0-9]/g, '')]
  return base ? `${base}${encodeURIComponent(safeHash)}` : null
}

function extractTransactionHistoryDetails(result = {}, networks = {}) {
  const details = {}
  const payinHash = normalizeTransactionHash(result.payinHash)
  const payoutHash = normalizeTransactionHash(result.payoutHash)
  const fromNetwork = result.fromNetwork ?? networks.fromNetwork
  const toNetwork = result.toNetwork ?? networks.toNetwork

  if (payinHash) {
    details.payinHash = payinHash
    details.payinExplorerUrl = networkExplorerUrl(fromNetwork, payinHash)
  }
  if (payoutHash) {
    details.payoutHash = payoutHash
    details.payoutExplorerUrl = networkExplorerUrl(toNetwork, payoutHash)
  }

  return details
}

module.exports = { extractTransactionHistoryDetails, networkExplorerUrl }