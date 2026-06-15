import { type CaptchaConfig, type CaptchaOptionValues, readCaptchaConfig } from '../../domain/captcha'
import type { SystemOptionsRepo } from '../ports'

export type CaptchaDeps = { systemOptions: SystemOptionsRepo }

async function loadCaptchaOptionValuesFromRepo(systemOptions: SystemOptionsRepo): Promise<CaptchaOptionValues> {
  const rows = await systemOptions.listByKeyLike('captcha_%')
  const values: CaptchaOptionValues = {}
  for (const row of rows) values[row.key] = row.value
  return values
}

export async function loadCaptchaOptionValues(deps: CaptchaDeps): Promise<CaptchaOptionValues> {
  return loadCaptchaOptionValuesFromRepo(deps.systemOptions)
}

export async function loadCaptchaConfig(deps: CaptchaDeps): Promise<CaptchaConfig | null> {
  return readCaptchaConfig(await loadCaptchaOptionValuesFromRepo(deps.systemOptions))
}
