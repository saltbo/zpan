// Builds an RFC 6266 `Content-Disposition` for forced downloads.
//
// The plain `filename=` parameter must be ASCII-only: it is signed into the S3
// presigned PUT and then set as an XHR request header by the browser, and
// `XMLHttpRequest.setRequestHeader` rejects any value containing a code point
// above U+00FF ("String contains non ISO-8859-1 code point"). Non-ASCII names
// (Chinese, emoji, …) are carried losslessly by the percent-encoded
// `filename*=UTF-8''` form, which every modern browser prefers.
export function attachmentContentDisposition(name: string): string {
  const asciiFallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
