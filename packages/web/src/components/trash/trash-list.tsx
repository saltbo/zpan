import { DirType } from '@zpan/shared/constants'
import type { StorageObject } from '@zpan/shared/types'
import { File, Folder, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatDate, formatSize } from './format-utils'

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
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="w-10 px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label={t('recycleBin.selectAll')}
                className="h-4 w-4 rounded border-gray-300"
              />
            </th>
            <th className="px-4 py-3 text-left font-medium">{t('recycleBin.colName')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('recycleBin.colOriginalLocation')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('recycleBin.colTrashedDate')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('recycleBin.colSize')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('recycleBin.colActions')}</th>
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
                {t('recycleBin.noItems')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={t('recycleBin.selectItem', { name: item.name })}
          className="h-4 w-4 rounded border-gray-300"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isFolder ? <Folder className="h-4 w-4 text-blue-500" /> : <File className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{item.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{item.parent || '/'}</td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(item.updatedAt)}</td>
      <td className="px-4 py-3 text-muted-foreground">{isFolder ? '—' : formatSize(item.size)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon-xs" onClick={onRestore} title={t('recycleBin.restore')}>
            <RotateCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDeletePermanently}
            title={t('recycleBin.deletePermanently')}
          >
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}
