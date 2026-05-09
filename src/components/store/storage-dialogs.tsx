import { Gift } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function StorageActions({ onRedeem, isRedeeming }: { onRedeem: (code: string) => void; isRedeeming: boolean }) {
  const { t } = useTranslation()
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [code, setCode] = useState('')

  return (
    <Dialog open={redeemOpen} onOpenChange={setRedeemOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gift />
          {t('storage.redeemTitle')}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-4 p-5 sm:max-w-md">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">{t('storage.redeemTitle')}</DialogTitle>
          <DialogDescription className="text-xs leading-5">{t('storage.redeemDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="code" className="text-xs">
              {t('storage.giftCardCode')}
            </Label>
            <Input
              id="code"
              placeholder="ZS-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isRedeeming}
            />
          </div>
          <Button
            className="w-full"
            disabled={!code.trim() || isRedeeming}
            onClick={() => {
              onRedeem(code.trim())
              setCode('')
              setRedeemOpen(false)
            }}
          >
            {t('storage.redeemAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
