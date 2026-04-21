/// <reference types="vite/client" />

import '@tanstack/react-table'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    className?: string
    flex?: boolean
  }
}
