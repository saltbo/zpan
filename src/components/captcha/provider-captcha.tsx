import { CaptchaFox } from '@better-captcha/react/provider/captcha-fox'
import { HCaptcha } from '@better-captcha/react/provider/hcaptcha'
import { ReCaptcha } from '@better-captcha/react/provider/recaptcha'
import { Turnstile } from '@better-captcha/react/provider/turnstile'
import type { CaptchaProvider } from '@shared/captcha'

type ProviderCaptchaProps = {
  provider: CaptchaProvider
  siteKey: string
  onToken: (token: string) => void
}

export function ProviderCaptcha({ provider, siteKey, onToken }: ProviderCaptchaProps) {
  const commonProps = {
    sitekey: siteKey,
    onSolve: onToken,
    onError: () => onToken(''),
  }

  if (provider === 'google-recaptcha') return <ReCaptcha {...commonProps} />
  if (provider === 'hcaptcha') return <HCaptcha {...commonProps} />
  if (provider === 'captchafox') return <CaptchaFox {...commonProps} />
  return <Turnstile {...commonProps} />
}
