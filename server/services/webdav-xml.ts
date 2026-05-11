import { DirType } from '../../shared/constants'
import type { Matter } from './matter'
import type { WebDavWorkspace } from './webdav-path'
import { matterHref, workspaceHref } from './webdav-path'

interface DavEntry {
  href: string
  collection: boolean
  contentType: string
  contentLength: number
  updatedAt: Date
}

export function workspaceEntry(workspace: WebDavWorkspace): DavEntry {
  return {
    href: workspaceHref(workspace),
    collection: true,
    contentType: 'httpd/unix-directory',
    contentLength: 0,
    updatedAt: new Date(),
  }
}

export function mountRootEntry(): DavEntry {
  return {
    href: '/dav/',
    collection: true,
    contentType: 'httpd/unix-directory',
    contentLength: 0,
    updatedAt: new Date(),
  }
}

export function matterEntry(workspace: WebDavWorkspace, matter: Matter): DavEntry {
  const collection = matter.dirtype !== DirType.FILE
  return {
    href: collection ? `${matterHref(workspace, matter)}/` : matterHref(workspace, matter),
    collection,
    contentType: collection ? 'httpd/unix-directory' : matter.type,
    contentLength: matter.size ?? 0,
    updatedAt: matter.updatedAt,
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
        <D:resourcetype>${entry.collection ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getcontentlength>${entry.contentLength}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(entry.contentType)}</D:getcontenttype>
        <D:getlastmodified>${entry.updatedAt.toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
