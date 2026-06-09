import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
  type CaptchaProvider,
  DEFAULT_CAPTCHA_PROVIDER,
} from '@shared/captcha'
import { DEFAULT_ORG_QUOTA, DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME, SignupMode } from '@shared/constants'
import { useQuery } from '@tanstack/react-query'
import { listSystemOptions, type SiteOption } from '@/lib/api'

export type { SiteOption }

export const siteOptionsQueryKey = ['system', 'options'] as const

export function resolveDefaultOrgQuotaValue(raw: string | undefined): number {
  const quota = Number(raw)
  return Number.isFinite(quota) && quota > 0 ? quota : DEFAULT_ORG_QUOTA
}

export function useSiteOptions() {
  const { data, isLoading, isError } = useQuery({
    queryKey: siteOptionsQueryKey,
    queryFn: listSystemOptions,
    staleTime: 5 * 60 * 1000,
  })

  const items = data?.items ?? []
  const optionMap = new Map(items.map((item) => [item.key, item.value]))

  return {
    siteName: optionMap.get('site_name') ?? DEFAULT_SITE_NAME,
    siteDescription: optionMap.get('site_description') ?? DEFAULT_SITE_DESCRIPTION,
    sitePublicOrigin: optionMap.get('site_public_origin') ?? '',
    defaultOrgQuota: resolveDefaultOrgQuotaValue(optionMap.get('default_org_quota')),
    authSignupMode: (optionMap.get('auth_signup_mode') as SignupMode) ?? SignupMode.OPEN,
    captchaEnabled: optionMap.get(CAPTCHA_ENABLED_KEY) === 'true',
    captchaProvider: (optionMap.get(CAPTCHA_PROVIDER_KEY) as CaptchaProvider | undefined) ?? DEFAULT_CAPTCHA_PROVIDER,
    captchaSiteKey: optionMap.get(CAPTCHA_SITE_KEY_KEY) ?? '',
    captchaSecretKey: optionMap.get(CAPTCHA_SECRET_OPTION_KEY) ?? '',
    captchaMinScore: optionMap.get(CAPTCHA_MIN_SCORE_KEY) ?? '',
    isLoading,
    isError,
  }
}
