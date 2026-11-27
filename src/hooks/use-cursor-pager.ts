import { useState } from 'react'

// Previous/next over an opaque cursor. The stack holds the token of every page
// visited so far (undefined for the first), so "previous" pops back without a
// page number or a count. Any change to `resetKey` (filters, page size) returns
// to the first page, because a token is bound to the query it came from.
export function useCursorPager(resetKey: string) {
  const [state, setState] = useState<{ key: string; stack: (string | undefined)[] }>({
    key: resetKey,
    stack: [undefined],
  })
  const stack = state.key === resetKey ? state.stack : [undefined]
  if (state.key !== resetKey) setState({ key: resetKey, stack })

  return {
    pageToken: stack[stack.length - 1],
    hasPrevious: stack.length > 1,
    next(token: string) {
      setState({ key: resetKey, stack: [...stack, token] })
    },
    previous() {
      if (stack.length > 1) setState({ key: resetKey, stack: stack.slice(0, -1) })
    },
    reset() {
      setState({ key: resetKey, stack: [undefined] })
    },
  }
}
