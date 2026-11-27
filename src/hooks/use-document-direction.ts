import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { applyDocumentDirection } from '@/lib/document-direction'

/**
 * Keeps `<html>` in step with the active language. main.tsx applies the direction
 * before the first render, so menus mount with it; this hook re-applies it every
 * time the visitor changes language, including from the sign-in corner controls.
 * `useTranslation` re-renders on `languageChanged`, so the language values in the
 * dependency list are what re-run the effect (the i18n instance itself is stable).
 */
export function useDocumentDirection() {
  const { i18n } = useTranslation()
  const language = i18n.language
  const resolvedLanguage = i18n.resolvedLanguage
  // biome-ignore lint/correctness/useExhaustiveDependencies: the language values are what change on a language switch (useTranslation re-renders on languageChanged); the i18n instance is stable, so the effect must be keyed to them.
  useEffect(() => {
    applyDocumentDirection(i18n)
  }, [i18n, language, resolvedLanguage])
}
