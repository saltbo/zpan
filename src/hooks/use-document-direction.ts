import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { applyDocumentDirection } from '@/lib/document-direction'

/**
 * Keeps `<html>` in step with the active language. main.tsx applies the direction
 * before the first render, so menus mount with it; this hook re-applies it every
 * time the visitor changes language, including from the sign-in corner controls.
 */
export function useDocumentDirection() {
  const { i18n } = useTranslation()
  useEffect(() => {
    applyDocumentDirection(i18n)
  }, [i18n])
}
