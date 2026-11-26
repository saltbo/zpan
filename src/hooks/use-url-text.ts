import { useEffect, useRef, useState } from 'react'

// A text field whose value lives in the URL. The router applies each navigation
// asynchronously, so binding the field straight to the URL drops keystrokes typed
// before the previous one lands. The field keeps its own text, writes each change
// to the URL, and takes the URL's value only when it comes from elsewhere, such as
// back or forward.
export function useUrlText(urlValue: string, writeToUrl: (value: string) => void) {
  const [text, setText] = useState(urlValue)
  const pending = useRef<string[]>([])

  useEffect(() => {
    const index = pending.current.indexOf(urlValue)
    if (index >= 0) {
      pending.current.splice(0, index + 1)
      return
    }
    pending.current = []
    setText(urlValue)
  }, [urlValue])

  function onTextChange(value: string) {
    setText(value)
    pending.current.push(value)
    writeToUrl(value)
  }

  return [text, onTextChange] as const
}
