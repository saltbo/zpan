import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

// Every string the admin analytics page renders. The page used to ship
// hardcoded Chinese, so English users saw Chinese copy in every section.
const P = 'admin.analytics'
const ALL_KEYS = [
  `${P}.title`,
  `${P}.description`,

  `${P}.section.growth.title`,
  `${P}.section.growth.description`,
  `${P}.section.storage.title`,
  `${P}.section.storage.description`,
  `${P}.section.traffic.title`,
  `${P}.section.traffic.description`,
  `${P}.section.sharing.title`,
  `${P}.section.sharing.description`,
  `${P}.section.expand`,
  `${P}.section.collapse`,

  `${P}.upgrade.title`,
  `${P}.upgrade.description`,
  `${P}.upgrade.action`,

  `${P}.range.select`,
  `${P}.range.apply`,
  `${P}.preset.last3`,
  `${P}.preset.last7`,
  `${P}.preset.last30`,
  `${P}.preset.thisMonth`,
  `${P}.preset.lastMonth`,

  `${P}.delta`,
  `${P}.empty`,
  `${P}.loadError`,
  `${P}.retry`,

  `${P}.metric.totalUsers`,
  `${P}.metric.newUsers`,
  `${P}.metric.verifiedUsers`,
  `${P}.metric.activeUsers30`,
  `${P}.metric.silentUsers`,
  `${P}.metric.bannedUsers`,
  `${P}.metric.previousNewUsers`,
  `${P}.metric.change`,
  `${P}.metric.share`,
  `${P}.metric.activeRate30`,
  `${P}.metric.storageUsedEnd`,
  `${P}.metric.quotaUtilization`,
  `${P}.metric.trashUsage`,
  `${P}.metric.confirmedBytes`,
  `${P}.metric.confirmedFiles`,
  `${P}.metric.previousCapacity`,
  `${P}.metric.activeFileCount`,
  `${P}.metric.filesOver90Days`,
  `${P}.metric.coldFileShare`,
  `${P}.metric.endPeriodUsage`,
  `${P}.metric.issuedBytes`,
  `${P}.metric.peakDailyBytes`,
  `${P}.metric.requests`,
  `${P}.metric.issuedDownloads`,
  `${P}.metric.blockedIssues`,
  `${P}.metric.downloadIssueSuccessRate`,
  `${P}.metric.issuedSuccessfully`,
  `${P}.metric.statBasis`,
  `${P}.metric.uploadPlusIssue`,
  `${P}.metric.periodTotal`,
  `${P}.metric.activeSharesEnd`,
  `${P}.metric.createdInRange`,
  `${P}.metric.previousCreated`,
  `${P}.metric.totalViews`,
  `${P}.metric.exactShareViews`,
  `${P}.metric.locatedDownloads`,
  `${P}.metric.previousDownloads`,
  `${P}.metric.savedToDrive`,
  `${P}.metric.previousSaves`,

  `${P}.chart.userScaleTrend`,
  `${P}.chart.userScaleTrendDescription`,
  `${P}.chart.activeUserTrend`,
  `${P}.chart.activeUserTrendDescription`,
  `${P}.chart.userStatus`,
  `${P}.chart.registrationSources`,
  `${P}.chart.quotaPressure`,
  `${P}.chart.quotaPressureDescription`,
  `${P}.chart.storageTrend`,
  `${P}.chart.storageTrendDescription`,
  `${P}.chart.fileTypeShare`,
  `${P}.chart.fileSizeStructure`,
  `${P}.chart.fileSizeStructureDescription`,
  `${P}.chart.fileAge`,
  `${P}.chart.fileAgeDescription`,
  `${P}.chart.trafficTrend`,
  `${P}.chart.trafficTrendDescription`,
  `${P}.chart.trafficSources`,
  `${P}.chart.successRates`,
  `${P}.chart.successRatesDescription`,
  `${P}.chart.failureReasons`,
  `${P}.chart.failureReasonsDescription`,
  `${P}.chart.sharingTrend`,
  `${P}.chart.sharingTrendDescription`,
  `${P}.chart.shareTypes`,
  `${P}.chart.shareSources`,
  `${P}.chart.topShares`,

  `${P}.series.cumulativeUsers`,
  `${P}.series.storageUsage`,
  `${P}.series.confirmedUploadBytes`,
  `${P}.series.issuedDownloadBytes`,
  `${P}.series.fileCount`,
  `${P}.series.capacityContribution`,
  `${P}.series.capacity`,
  `${P}.series.uploadSuccessRate`,
  `${P}.series.downloadSuccessRate`,
  `${P}.series.failureCount`,
  `${P}.series.save`,
  `${P}.series.count`,

  `${P}.table.space`,
  `${P}.table.type`,
  `${P}.table.used`,
  `${P}.table.quota`,
  `${P}.table.utilization`,
  `${P}.table.share`,
  `${P}.table.creator`,
  `${P}.table.views`,
  `${P}.table.downloads`,
  `${P}.table.sharePercent`,

  `${P}.label.normal`,
  `${P}.label.unverified`,
  `${P}.label.banned`,
  `${P}.label.silent`,
  `${P}.label.direct`,
  `${P}.label.credential`,
  `${P}.label.landing`,
  `${P}.label.direct_share`,
  `${P}.label.views`,
  `${P}.label.downloads`,
  `${P}.label.saved_to_drive`,
  `${P}.label.landing_share`,
  `${P}.label.object_download`,
  `${P}.label.webdav_download`,
  `${P}.label.upload`,
  `${P}.label.reported`,
  `${P}.label.pending`,
  `${P}.label.failed`,
]

// The page's copy lives in the locale files, so every key analytics.tsx renders
// must resolve in both locales. A hand-maintained list can drift from what the
// page actually asks for, so the page source is the authority: this reads the
// component and collects the literal `t('admin.analytics.*')` lookups in it.
const ANALYTICS_SOURCE = readFileSync(join(process.cwd(), 'src/routes/_authenticated/admin/analytics.tsx'), 'utf8')
const REFERENCED_KEYS = [
  ...new Set([...ANALYTICS_SOURCE.matchAll(/t\(\s*'(admin\.analytics\.[A-Za-z0-9_.]+)'/g)].map((match) => match[1])),
]
// Section copy is looked up from the section id (`admin.analytics.section.${id}.title`),
// so the four section ids carry the keys the dynamic lookup resolves to.
const SECTION_IDS = ['growth', 'storage', 'traffic', 'sharing']
const SECTION_KEYS = SECTION_IDS.flatMap((id) => [`${P}.section.${id}.title`, `${P}.section.${id}.description`])

describe('admin.analytics locale keys — page source references', () => {
  it('every key analytics.tsx renders exists in en.json with a value', () => {
    expect(REFERENCED_KEYS.filter((key) => !enLocale[key]?.trim())).toEqual([])
  })

  it('every key analytics.tsx renders exists in zh.json with a value', () => {
    expect(REFERENCED_KEYS.filter((key) => !zhLocale[key]?.trim())).toEqual([])
  })

  it('the section keys for every section id exist in both locales', () => {
    expect(SECTION_KEYS.filter((key) => !enLocale[key]?.trim())).toEqual([])
    expect(SECTION_KEYS.filter((key) => !zhLocale[key]?.trim())).toEqual([])
  })

  it('referenced English values are not Chinese script', () => {
    for (const key of [...REFERENCED_KEYS, ...SECTION_KEYS]) {
      expect(enLocale[key]).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })

  it('the chart series names the page renders resolve to readable labels', () => {
    // Chart legends and tooltips show the series `name`, so a missing key would
    // print the key itself. These are the series on the three trend charts.
    const seriesKeys = [
      `${P}.metric.newUsers`,
      `${P}.series.cumulativeUsers`,
      `${P}.metric.confirmedFiles`,
      `${P}.series.storageUsage`,
      `${P}.metric.confirmedBytes`,
    ]
    for (const key of seriesKeys) {
      expect(enLocale[key]).not.toMatch(/^admin\.analytics\./)
      expect(zhLocale[key]).not.toMatch(/^admin\.analytics\./)
    }
  })
})

describe('admin.analytics locale keys — non-empty values', () => {
  for (const key of ALL_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]?.trim()).not.toBe('')
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]?.trim()).not.toBe('')
    })
  }

  it('the analytics page has no English value left in Chinese script', () => {
    for (const key of ALL_KEYS) {
      expect(enLocale[key]).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
})

describe('admin.analytics locale keys — English values contract', () => {
  const contract: Array<[string, string]> = [
    [`${P}.title`, 'Site Statistics'],
    [`${P}.description`, 'View site statistics by UTC date.'],
    [`${P}.section.growth.title`, 'Users & growth'],
    [`${P}.section.storage.title`, 'Storage & files'],
    [`${P}.section.traffic.title`, 'Traffic & transfers'],
    [`${P}.section.sharing.title`, 'Sharing & access'],
    [`${P}.section.expand`, 'Expand {{name}}'],
    [`${P}.section.collapse`, 'Collapse {{name}}'],
    [`${P}.upgrade.title`, 'Unlock advanced statistics'],
    [`${P}.upgrade.action`, 'Open licensing'],
    [`${P}.range.select`, 'Select date range'],
    [`${P}.range.apply`, 'Apply'],
    [`${P}.preset.last3`, 'Last 3 days'],
    [`${P}.preset.last30`, 'Last 30 days'],
    [`${P}.preset.thisMonth`, 'This month'],
    [`${P}.preset.lastMonth`, 'Last month'],
    [`${P}.empty`, 'No statistics available'],
    [`${P}.loadError`, 'Failed to load statistics.'],
    [`${P}.retry`, 'Retry'],
    [`${P}.metric.totalUsers`, 'Total users'],
    [`${P}.metric.activeUsers30`, '30-day active users'],
    [`${P}.chart.userScaleTrend`, 'User scale trend'],
    [`${P}.chart.userStatus`, 'User status distribution'],
    [`${P}.chart.topShares`, 'Top shares'],
    [`${P}.table.share`, 'Share'],
    [`${P}.table.creator`, 'Creator'],
    [`${P}.label.normal`, 'Normal users'],
    [`${P}.label.failed`, 'Failed'],
  ]

  for (const [key, value] of contract) {
    it(`${key} is "${value}"`, () => {
      expect(enLocale[key]).toBe(value)
    })
  }
})

describe('admin.analytics locale keys — Chinese values contract', () => {
  const contract: Array<[string, string]> = [
    [`${P}.title`, '站点统计'],
    [`${P}.description`, '按 UTC 日期查看站点统计。'],
    [`${P}.section.growth.title`, '用户与增长'],
    [`${P}.section.growth.description`, '观察用户规模、活跃度、账号状态和注册方式结构。'],
    [`${P}.section.storage.title`, '存储与文件'],
    [`${P}.section.traffic.title`, '流量与传输'],
    [`${P}.section.sharing.title`, '分享与访问'],
    [`${P}.upgrade.title`, '解锁高级统计'],
    [`${P}.upgrade.description`, '这些统计看板需要 ZPan Pro 或 Business。'],
    [`${P}.empty`, '暂无统计数据'],
    [`${P}.loadError`, '统计结果加载失败。'],
    [`${P}.retry`, '重试'],
    [`${P}.metric.totalUsers`, '总用户数'],
    [`${P}.chart.userScaleTrend`, '用户规模趋势'],
    [`${P}.chart.topShares`, 'Top 分享'],
    [`${P}.label.normal`, '正常用户'],
    [`${P}.label.saved_to_drive`, '转存到网盘'],
  ]

  for (const [key, value] of contract) {
    it(`${key} is "${value}"`, () => {
      expect(zhLocale[key]).toBe(value)
    })
  }
})

describe('admin.analytics locale keys — i18n runtime translation', () => {
  it('translates the page title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t(`${P}.title`)).toBe('Site Statistics')
    expect(i18n.t(`${P}.section.growth.title`)).toBe('Users & growth')
  })

  it('translates the page title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t(`${P}.title`)).toBe('站点统计')
    expect(i18n.t(`${P}.section.growth.title`)).toBe('用户与增长')
  })

  it('interpolates the section toggle aria-label in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t(`${P}.section.collapse`, { name: 'Users & growth' })).toBe('Collapse Users & growth')
  })

  it('interpolates the quota pressure sentence in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t(`${P}.chart.quotaPressureDescription`, { near: 2, over: 1, invalid: 0 })).toBe(
      'Of all spaces, 2 reach 80%, 1 reach or exceed quota, and 0 have invalid quota settings.',
    )
  })

  it('falls back to the raw machine value for an unknown label', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t(`${P}.label.custom_org_type`, { defaultValue: 'custom_org_type' })).toBe('custom_org_type')
  })
})
