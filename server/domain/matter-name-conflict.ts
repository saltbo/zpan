// Windows-style auto-rename: "report.pdf" → "report (1).pdf", then " (2)", ...
// For folders or dot-prefixed names the suffix is appended to the whole name.
// Pure: no I/O, the repo drives the availability search around this.
export function suggestRenamed(name: string, index: number): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name} (${index})`
  return `${name.slice(0, dot)} (${index})${name.slice(dot)}`
}
