import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const STORAGE_METERING_KEYS = [
  'quota.traffic',
  'quota.cloudStorageEntitlement',
  'quota.trafficUsage',
  'quota.trafficUsageNoLimit',
  'quota.purchasedTraffic',
  'storage.effectiveStorageQuota',
  'storage.storageUsage',
  'storage.baseStorageQuota',
  'storage.cloudStorageEntitlement',
  'storage.includedTraffic',
  'storage.currentPeriodTraffic',
  'storage.trafficUsage',
  'storage.currentPlan',
  'storage.currentPlanDescription',
  'storage.planActive',
  'storage.freePlanName',
  'storage.freePlanDescription',
  'storage.freeQuotaTitle',
  'storage.freeQuotaDescription',
  'storage.freePlanPrice',
  'storage.usageTotal',
  'storage.usageNoLimit',
  'storage.storageQuotaDetail',
  'storage.trafficQuotaDetail',
  'storage.usedStorage',
  'storage.trafficPeriodDetail',
  'storage.overCap',
  'storage.plansTitle',
  'storage.plansDescription',
  'storage.checkoutPlan',
  'storage.activeEntitlement',
  'storage.availablePlansTitle',
  'storage.availablePlansDescription',
  'storage.planBilling',
  'storage.billingMonthly',
  'storage.billingFixedDays',
  'storage.billingOneTime',
  'storage.trafficPolicy',
  'storage.trafficStopsAtQuota',
  'storage.trafficOverageEnabled',
  'storage.trafficOveragePerGb',
  'admin.cloudStore.planName',
  'admin.cloudStore.noPlans',
  'admin.cloudStore.orders.planQuota',
  'admin.cloudStore.orders.storageQuota',
  'admin.cloudStore.orders.trafficQuota',
]

describe('storage metering locale keys', () => {
  for (const key of STORAGE_METERING_KEYS) {
    it(`has non-empty translations for ${key}`, () => {
      expect(enLocale[key]).toBeTruthy()
      expect(zhLocale[key]).toBeTruthy()
    })
  }

  it('uses storage plan language in English', () => {
    expect(enLocale['storage.plansTitle']).toBe('Storage plans')
    expect(enLocale['admin.cloudStore.tabs.packages']).toBe('Plans')
  })

  it('uses storage plan language in Chinese', () => {
    expect(zhLocale['storage.plansTitle']).toBe('存储计划')
    expect(zhLocale['admin.cloudStore.tabs.packages']).toBe('计划')
  })
})
