import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface CursorPaginationProps {
  pageSize: number
  pageSizeOptions: readonly number[]
  hasPrevious: boolean
  nextPageToken: string | null | undefined
  disabled?: boolean
  onPageSizeChange: (pageSize: number) => void
  onPrevious: () => void
  onNext: (pageToken: string) => void
}

// Admin tables page with previous/next and a page-size choice over the shared
// cursor (UX.md, Lists). There are no page numbers: they would need a count.
export function CursorPagination({
  pageSize,
  pageSizeOptions,
  hasPrevious,
  nextPageToken,
  disabled = false,
  onPageSizeChange,
  onPrevious,
  onNext,
}: CursorPaginationProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t('common.rowsPerPage')}</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))} disabled={disabled}>
          <SelectTrigger className="h-8 w-32" aria-label={t('common.rowsPerPage')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {t('common.pageSizeOption', { count: option })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled || !hasPrevious} onClick={onPrevious}>
          <ChevronLeft />
          {t('common.previousPage')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !nextPageToken}
          onClick={() => nextPageToken && onNext(nextPageToken)}
        >
          {t('common.nextPage')}
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
