function normalizeCurrencyCatalog(payload) {
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.currencies)
      ? payload.currencies
      : []
  const currenciesById = new Map()

  for (const record of records) {
    if (!record || record.isFiat === true) continue
    if (typeof record.ticker !== 'string' || typeof record.network !== 'string' || typeof record.name !== 'string') continue

    const ticker = record.ticker.trim().toLowerCase()
    const network = record.network.trim().toLowerCase()
    if (!ticker || !network) continue

    const id = `${ticker}:${network}`
    if (currenciesById.has(id)) continue

    currenciesById.set(id, {
      id,
      ticker,
      network,
      name: record.name.trim(),
      image: typeof record.image === 'string' ? record.image : '',
      featured: record.featured === true,
      tokenContract: typeof record.tokenContract === 'string' ? record.tokenContract : null,
      hasExternalId: record.hasExternalId === true || record.isExtraIdSupported === true,
    })
  }

  return [...currenciesById.values()].sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1
    return left.name.localeCompare(right.name) || left.network.localeCompare(right.network)
  })
}

module.exports = { normalizeCurrencyCatalog }
