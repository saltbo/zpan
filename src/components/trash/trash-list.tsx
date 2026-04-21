import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { File, Folder, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDate, formatSize } from '@/lib/format'

interface TrashListProps {
  items: StorageObject[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onRestore: (id: string) => void
  onDeletePermanently: (id: string) => void
}

export function TrashList({
  items,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRestore,
  onDeletePermanently,
}: TrashListProps) {
  const { t } = useTranslation()
  const allSelected = items.length > 0 && selectedIds.size === items.length

  return (
    <Card className="gap-0 overflow-x-auto py-0 shadow-none">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="w-10 pl-4 pr-0 py-3 text-left">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label={t('trash.selectAll')}
                className="h-4 w-4 rounded border-gray-300"
              />
            </th>
            <th className="px-4 py-3 text-left font-medium">{t('trash.colName')}</th>
            <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">{t('trash.colOriginalLocation')}</th>
            <th className="hidden px-4 py-3 text-left font-medium md:table-cell">{t('trash.colTrashedDate')}</th>
            <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">{t('trash.colSize')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('trash.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <TrashRow
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => onToggleSelect(item.id)}
              onRestore={() => onRestore(item.id)}
              onDeletePermanently={() => onDeletePermanently(item.id)}
            />
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                {t('trash.noItems')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  )
}

function TrashRow({
  item,
  selected,
  onToggleSelect,
  onRestore,
  onDeletePermanently,
}: {
  item: StorageObject
  selected: boolean
  onToggleSelect: () => void
  onRestore: () => void
  onDeletePermanently: () => void
}) {
  const { t } = useTranslation()
  const isFolder = item.dirtype !== DirType.FILE

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="pl-4 pr-0 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={t('trash.selectItem', { name: item.name })}
          className="h-4 w-4 rounded border-gray-300"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isFolder ? <Folder className="h-4 w-4 text-blue-500" /> : <File className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{item.name}</span>
        </div>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{item.parent || '/'}</td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatDate(item.updatedAt)}</td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{isFolder ? '—' : formatSize(item.size)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon-xs" onClick={onRestore} title={t('trash.restore')}>
            <RotateCcw />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onDeletePermanently} title={t('trash.deletePermanently')}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}
