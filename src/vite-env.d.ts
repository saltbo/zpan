/// <reference types="vite/client" />

import '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // biome-ignore lint/correctness/noUnusedVariables: required by module augmentation
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}
