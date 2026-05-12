import { DirType } from '../../shared/constants'
import type { Matter } from './matter'
import type { WebDavWorkspace } from './webdav-path'
import { matterHref, workspaceHref } from './webdav-path'

interface DavEntry {
  href: string
  displayName: string
  collection: boolean
  contentType: string
  contentLength: number
  createdAt: Date
  updatedAt: Date
  etag: string
}

export function workspaceEntry(workspace: WebDavWorkspace): DavEntry {
  const now = new Date()
  return {
    href: workspaceHref(workspace),
    displayName: workspace.name,
    collection: true,
    contentType: 'httpd/unix-directory',
    contentLength: 0,
    createdAt: now,
    updatedAt: now,
    etag: davEtag(workspace.id, 0, now),
  }
}

export function mountRootEntry(): DavEntry {
  const now = new Date()
  return {
    href: '/dav/',
    displayName: 'dav',
    collection: true,
    contentType: 'httpd/unix-directory',
    contentLength: 0,
    createdAt: now,
    updatedAt: now,
    etag: davEtag('mount-root', 0, now),
  }
}

export function matterEntry(workspace: WebDavWorkspace, matter: Matter): DavEntry {
  const collection = matter.dirtype !== DirType.FILE
  return {
    href: collection ? `${matterHref(workspace, matter)}/` : matterHref(workspace, matter),
    displayName: matter.name,
    collection,
    contentType: collection ? 'httpd/unix-directory' : matter.type,
    contentLength: matter.size ?? 0,
    createdAt: matter.createdAt,
    updatedAt: matter.updatedAt,
    etag: davEtag(matter.id, matter.size ?? 0, matter.updatedAt),
  }
}

export function multistatus(entries: DavEntry[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${entries.map(response).join('\n')}\n</D:multistatus>`
}

function response(entry: DavEntry): string {
  return `  <D:response>
    <D:href>${escapeXml(entry.href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(entry.displayName)}</D:displayname>
        <D:creationdate>${entry.createdAt.toISOString()}</D:creationdate>
        <D:getetag>${escapeXml(entry.etag)}</D:getetag>
        <D:resourcetype>${entry.collection ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getcontentlength>${entry.contentLength}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(entry.contentType)}</D:getcontenttype>
        <D:getlastmodified>${entry.updatedAt.toUTCString()}</D:getlastmodified>
        <D:supportedlock/>
        <D:lockdiscovery/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
}

export function davEtag(id: string, size: number, updatedAt: Date): string {
  return `"${id}-${size}-${updatedAt.getTime()}"`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
