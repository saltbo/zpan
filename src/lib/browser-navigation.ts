export function redirectExternal(url: string) {
  window.location.assign(url)
}

export function openNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

// Starts a download from a URL that answers with an attachment, in the current
// tab: a link clicked from script is not a popup, so popup blockers leave it
// alone even after an await, and the page stays where it is.
export function startDownload(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
