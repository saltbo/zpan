import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { IhostConfigResponse } from '@/lib/api'
import { CustomDomainPanel } from './custom-domain-panel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ updateIhostConfig: vi.fn() }))
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => ({ hasFeature: () => true, isLoading: false }) }))

const config: IhostConfigResponse = {
  enabled: true,
  customDomain: 'img.example.com',
  domainVerifiedAt: null,
  domainStatus: 'failed',
  domainError: '自定义域名尚未通过验证，请检查其 DNS 记录是否指向所示目标。',
  dnsInstructions: [{ recordType: 'CNAME', name: 'img.example.com', target: 'ssl.example.com' }],
  verificationPath: null,
  refererAllowlist: null,
  createdAt: 1_780_000_000_000,
}

afterEach(cleanup)

function renderPanel(value: IhostConfigResponse) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <CustomDomainPanel orgId="org-1" config={value} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('CustomDomainPanel', () => {
  it('shows the domain error the server sends, in the language it chose [spec: error-messages/image-domain-status]', () => {
    const view = renderPanel(config)
    expect(view.getByText(config.domainError as string)).toBeTruthy()
    expect(view.getByText('ssl.example.com')).toBeTruthy()
  })

  it('shows no error line while the domain has none', () => {
    const view = renderPanel({ ...config, domainStatus: 'verified', domainError: null })
    expect(view.container.querySelector('.text-destructive')).toBeNull()
  })
})
