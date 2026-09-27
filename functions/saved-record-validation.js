const MAX_PRESETS_PER_USER = 25
const MAX_ADDRESS_BOOK_ENTRIES_PER_USER = 50
const MAX_DAILY_SAVED_RECORD_WRITES = 250

const presetSchema = {
  name: { maxLength: 48, required: true },
  sourceName: { maxLength: 48 },
  fromCurrency: { maxLength: 32, required: true, lowercase: true },
  fromNetwork: { maxLength: 32, required: true, lowercase: true },
  toCurrency: { maxLength: 32, required: true, lowercase: true },
  toNetwork: { maxLength: 32, required: true, lowercase: true },
  fromAmount: { maxLength: 48, required: true },
  destinationName: { maxLength: 48 },
  destinationAddress: { maxLength: 256, required: true },
  destinationExtraId: { maxLength: 256 },
  refundAddress: { maxLength: 256 },
  refundExtraId: { maxLength: 256 },
}

const addressBookSchema = {
  label: { maxLength: 48, required: true },
  address: { maxLength: 256, required: true },
  extraId: { maxLength: 256 },
  ticker: { maxLength: 32, required: true, lowercase: true },
  network: { maxLength: 32, required: true, lowercase: true },
  purpose: { maxLength: 16, required: true },
}

function normalizeRecord(input, schema) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Record must be an object.')
  }

  const allowedFields = new Set(Object.keys(schema))
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new Error('Record contains unsupported fields.')
  }

  return Object.fromEntries(Object.entries(schema).map(([field, constraints]) => {
    const value = input[field] ?? ''
    if (typeof value !== 'string') throw new Error(`Invalid ${field}.`)
    const trimmed = value.trim()
    if ((constraints.required && !trimmed) || trimmed.length > constraints.maxLength) {
      throw new Error(`Invalid ${field}.`)
    }
    return [field, constraints.lowercase ? trimmed.toLowerCase() : trimmed]
  }))
}

function validatePreset(input) {
  const preset = normalizeRecord(input, presetSchema)
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(preset.fromAmount) ||
    !Number.isFinite(Number(preset.fromAmount)) || Number(preset.fromAmount) <= 0) {
    throw new Error('Invalid fromAmount.')
  }
  return preset
}

function validateAddressBookEntry(input) {
  const entry = normalizeRecord(input, addressBookSchema)
  if (!['destination', 'refund'].includes(entry.purpose)) {
    throw new Error('Invalid purpose.')
  }
  return entry
}

module.exports = {
  MAX_PRESETS_PER_USER,
  MAX_ADDRESS_BOOK_ENTRIES_PER_USER,
  MAX_DAILY_SAVED_RECORD_WRITES,
  validatePreset,
  validateAddressBookEntry,
}
