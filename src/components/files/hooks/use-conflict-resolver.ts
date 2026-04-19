import type { ConflictStrategy } from '@shared/schemas'
import { useCallback, useRef, useState } from 'react'
import { isNameConflictError } from '@/lib/api'
import type { ConflictRequest } from '../dialogs/name-conflict-dialog'

export type PromptResult =
  | { strategy: ConflictStrategy; applyToAll: boolean }
  | { cancelled: true; applyToAll: boolean }

interface PendingPrompt {
  request: ConflictRequest
  resolve: (result: PromptResult) => void
}

/**
 * Bridges a promise-based API (good for async retry flows) with a React-rendered
 * dialog (good for composability). Callers `await prompt(req)` to get the user's
 * choice, and render `dialogState` in their tree to show the actual dialog.
 *
 * The "apply to all" checkbox is sticky across prompts within the same hook
 * instance: the caller reads `stickyStrategy` before prompting to skip the
 * dialog when the user already committed to a choice for the batch.
 */
export function useConflictResolver() {
  const [pending, setPending] = useState<PendingPrompt | null>(null)
  const [applyToAll, setApplyToAll] = useState(false)
  const stickyStrategyRef = useRef<ConflictStrategy | 'cancelled' | null>(null)

  const prompt = useCallback((request: ConflictRequest): Promise<PromptResult> => {
    // Honor the user's prior "apply to all" decision without re-prompting.
    const sticky = stickyStrategyRef.current
    if (sticky) {
      if (sticky === 'cancelled') return Promise.resolve({ cancelled: true, applyToAll: true })
      return Promise.resolve({ strategy: sticky, applyToAll: true })
    }
    return new Promise<PromptResult>((resolve) => {
      setPending({ request, resolve })
    })
  }, [])

  const choose = useCallback(
    (strategy: ConflictStrategy) => {
      if (!pending) return
      if (applyToAll) stickyStrategyRef.current = strategy
      pending.resolve({ strategy, applyToAll })
      setPending(null)
    },
    [pending, applyToAll],
  )

  const cancel = useCallback(() => {
    if (!pending) return
    if (applyToAll) stickyStrategyRef.current = 'cancelled'
    pending.resolve({ cancelled: true, applyToAll })
    setPending(null)
  }, [pending, applyToAll])

  /** Call when a new batch starts so previous "apply to all" decisions don't leak. */
  const reset = useCallback(() => {
    stickyStrategyRef.current = null
    setApplyToAll(false)
  }, [])

  return {
    prompt,
    reset,
    dialogState: {
      request: pending?.request ?? null,
      applyToAll,
      onApplyToAllChange: setApplyToAll,
      onChoose: choose,
      onCancel: cancel,
    },
  }
}

export type Prompt = (req: ConflictRequest) => Promise<PromptResult>

/**
 * Standard retry shape: run with a strategy and re-prompt whenever the server
 * returns a NAME_CONFLICT. Returns `undefined` when the user cancels. Non-conflict
 * errors propagate unchanged.
 *
 * The retry loop covers rare races where an auto-renamed name is itself taken
 * between the server picking it and the insert landing. Bounded at MAX_ATTEMPTS
 * so a pathologically contended target can't spin forever.
 */
const MAX_CONFLICT_RETRIES = 3

export async function withConflictRetry<T>(
  prompt: Prompt,
  kind: 'file' | 'folder',
  run: (strategy: ConflictStrategy | undefined) => Promise<T>,
  opts: { showApplyToAll?: boolean } = {},
): Promise<T | undefined> {
  let strategy: ConflictStrategy | undefined
  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
    try {
      return await run(strategy)
    } catch (e) {
      if (!isNameConflictError(e)) throw e
      if (attempt === MAX_CONFLICT_RETRIES) throw e
      const res = await prompt({ kind, name: e.body.conflictingName, showApplyToAll: opts.showApplyToAll })
      if ('cancelled' in res) return undefined
      strategy = res.strategy
    }
  }
  return undefined
}
