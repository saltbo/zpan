// Builds an RFC 6266 `Content-Disposition` for forced downloads.
//
// The plain `filename=` parameter stays ASCII for broad user-agent compatibility.
// Non-ASCII names (Chinese, emoji, …) are carried losslessly by the percent-encoded
// `filename*=UTF-8''` form, which every modern browser prefers.
export function attachmentContentDisposition(name: string): string {
  const asciiFallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
