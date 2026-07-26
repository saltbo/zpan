import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '@shared/captcha'
import { SITE_PUBLIC_ORIGIN_KEY } from '../../domain/site-public-origin'

export const SITE_SETTING_KEYS = {
  name: 'site_name',
  description: 'site_description',
  publicOrigin: SITE_PUBLIC_ORIGIN_KEY,
  signupMode: 'auth_signup_mode',
  captchaEnabled: CAPTCHA_ENABLED_KEY,
  captchaProvider: CAPTCHA_PROVIDER_KEY,
  captchaSiteKey: CAPTCHA_SITE_KEY_KEY,
  captchaSecretKey: CAPTCHA_SECRET_OPTION_KEY,
  captchaMinScore: CAPTCHA_MIN_SCORE_KEY,
  defaultOrgQuota: 'default_org_quota',
  defaultTeamQuota: 'default_team_quota',
  defaultMonthlyTrafficQuota: 'default_org_monthly_traffic_quota',
  webdavVerifiedOrigin: 'webdav_verified_origin',
  webdavVerifiedAt: 'webdav_verified_at',
  webdavVerificationError: 'webdav_verification_error',
  webdavEnabled: 'webdav_enabled',
  webdavDomain: 'webdav_domain',
} as const
