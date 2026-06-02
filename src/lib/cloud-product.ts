import type { CloudProduct } from '@shared/types'

export function cloudProductStorageBytes(pkg: CloudProduct) {
  return numberDeliverableValue(pkg, 'storageBytes')
}

export function cloudProductTrafficBytes(pkg: CloudProduct) {
  return numberDeliverableValue(pkg, 'trafficBytes')
}

export function cloudProductIncludedCredits(pkg: CloudProduct) {
  return numberDeliverableValue(pkg, 'includedCredits') || creditAmountFromPriceMetadata(pkg)
}

export function cloudProductValidityDays(pkg: CloudProduct) {
  return optionalNumberDeliverableValue(pkg, 'validityDays')
}

export function cloudProductTrafficOveragePriceCents(pkg: CloudProduct) {
  return optionalNumberDeliverableValue(pkg, 'trafficOveragePriceCents')
}

function numberDeliverableValue(pkg: CloudProduct, key: string) {
  return optionalNumberDeliverableValue(pkg, key) ?? 0
}

function optionalNumberDeliverableValue(pkg: CloudProduct, key: string) {
  const value = pkg.metadata.deliverable[key]
  return typeof value === 'number' ? value : undefined
}

function creditAmountFromPriceMetadata(pkg: CloudProduct) {
  const value = pkg.prices.find((price) => price.metadata?.creditAmount)?.metadata?.creditAmount
  if (!value) return 0
  const credits = Number(value)
  return Number.isSafeInteger(credits) && credits > 0 ? credits : 0
}
