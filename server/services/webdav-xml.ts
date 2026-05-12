import { DirType } from '../../shared/constants'
import type { Matter } from './matter'
import type { WebDavWorkspace } from './webdav-path'
import { matterHref, workspaceHref } from './webdav-path'
import type { DavDeadProperty, DavLock, DavPropertyName } from './webdav-state'

export const DAV_NAMESPACE = 'DAV:'

export interface DavEntry {
  href: string
  displayName: string
  collection: boolean
  contentType: string
  contentLength: number
  createdAt: Date
  updatedAt: Date
  etag: string
  deadProperties: DavDeadProperty[]
  locks: DavLock[]
}

export interface PropfindRequest {
  mode: 'allprop' | 'propname' | 'prop'
  properties: DavPropertyName[]
  include: DavPropertyName[]
}

export type ProppatchOperation =
  | { action: 'set'; property: DavDeadProperty }
  | { action: 'remove'; property: DavPropertyName }

export interface LockInfoRequest {
  owner: string
}

export function workspaceEntry(
  workspace: WebDavWorkspace,
  deadProperties: DavDeadProperty[],
  locks: DavLock[],
): DavEntry {
  const stableDate = new Date(0)
  return {
    href: workspaceHref(workspace),
    displayName: workspace.name,
    collection: true,
    contentType: 'httpd/unix-directory',
    contentLength: 0,
    createdAt: stableDate,
    updatedAt: stableDate,
    etag: davEtag(workspace.id, 0, stableDate),
    deadProperties,
    locks,
  }
}

export function mountRootEntry(): DavEntry {
  const stableDate = new Date(0)
  return {
    href: '/dav/',
    displayName: 'dav',
    collection: true,
    contentType: 'httpd/unix-directory',
    contentLength: 0,
    createdAt: stableDate,
    updatedAt: stableDate,
    etag: davEtag('mount-root', 0, stableDate),
    deadProperties: [],
    locks: [],
  }
}

export function matterEntry(
  workspace: WebDavWorkspace,
  matter: Matter,
  deadProperties: DavDeadProperty[],
  locks: DavLock[],
): DavEntry {
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
    deadProperties,
    locks,
  }
}

export function multistatus(entries: DavEntry[], request: PropfindRequest): string {
  return xmlDocument(
    `<D:multistatus xmlns:D="DAV:">\n${entries.map((entry) => response(entry, request)).join('\n')}\n</D:multistatus>`,
  )
}

export function proppatchMultistatus(href: string, properties: DavPropertyName[], status = 'HTTP/1.1 200 OK'): string {
  return xmlDocument(`<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
${properties.map((property) => `        ${emptyPropertyXml(property)}`).join('\n')}
      </D:prop>
      <D:status>${status}</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`)
}

export function errorXml(precondition: string, message?: string): string {
  const description = message ? `\n  <D:responsedescription>${escapeXml(message)}</D:responsedescription>` : ''
  return xmlDocument(`<D:error xmlns:D="DAV:">
  <D:${precondition}/>${description}
</D:error>`)
}

export function lockDiscoveryXml(lock: DavLock): string {
  return xmlDocument(`<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
${activeLockXml(lock)}
  </D:lockdiscovery>
</D:prop>`)
}

export function parsePropfindXml(body: string): PropfindRequest {
  if (!body.trim()) return { mode: 'allprop', properties: [], include: [] }
  const root = parseXmlElement(body)
  requireElement(root, DAV_NAMESPACE, 'propfind')

  const children = elementChildren(root)
  const prop = children.find((child) => isElement(child, DAV_NAMESPACE, 'prop'))
  const propname = children.find((child) => isElement(child, DAV_NAMESPACE, 'propname'))
  const allprop = children.find((child) => isElement(child, DAV_NAMESPACE, 'allprop'))
  const include = children.find((child) => isElement(child, DAV_NAMESPACE, 'include'))
  const selected = [prop, propname, allprop].filter(Boolean)
  if (selected.length !== 1) throw new Error('PROPFIND must contain exactly one request type')

  if (prop) return { mode: 'prop', properties: propertyNames(prop), include: [] }
  if (propname) return { mode: 'propname', properties: [], include: [] }
  return { mode: 'allprop', properties: [], include: include ? propertyNames(include) : [] }
}

export function parseProppatchXml(body: string): ProppatchOperation[] {
  const root = parseXmlElement(body)
  requireElement(root, DAV_NAMESPACE, 'propertyupdate')
  const operations: ProppatchOperation[] = []
  for (const instruction of elementChildren(root)) {
    if (!isElement(instruction, DAV_NAMESPACE, 'set') && !isElement(instruction, DAV_NAMESPACE, 'remove')) {
      throw new Error('PROPPATCH instructions must be set or remove')
    }
    const prop = elementChildren(instruction).find((child) => isElement(child, DAV_NAMESPACE, 'prop'))
    if (!prop) throw new Error('PROPPATCH instruction missing prop')
    for (const property of elementChildren(prop)) {
      if (property.namespace === DAV_NAMESPACE) throw new Error('Protected DAV properties cannot be patched')
      if (isElement(instruction, DAV_NAMESPACE, 'set')) {
        operations.push({
          action: 'set',
          property: { ...toPropertyName(property), value: propertyXmlWithNamespace(property) },
        })
      } else {
        operations.push({ action: 'remove', property: toPropertyName(property) })
      }
    }
  }
  if (operations.length === 0) throw new Error('PROPPATCH must change at least one property')
  return operations
}

export function parseLockInfoXml(body: string): LockInfoRequest {
  const root = parseXmlElement(body)
  requireElement(root, DAV_NAMESPACE, 'lockinfo')
  const lockscope = elementChildren(root).find((child) => isElement(child, DAV_NAMESPACE, 'lockscope'))
  const locktype = elementChildren(root).find((child) => isElement(child, DAV_NAMESPACE, 'locktype'))
  if (!lockscope || !locktype) throw new Error('LOCK request missing lockscope or locktype')
  const exclusive = elementChildren(lockscope).some((child) => isElement(child, DAV_NAMESPACE, 'exclusive'))
  const shared = elementChildren(lockscope).some((child) => isElement(child, DAV_NAMESPACE, 'shared'))
  const write = elementChildren(locktype).some((child) => isElement(child, DAV_NAMESPACE, 'write'))
  if (!exclusive || shared || !write) throw new Error('Only exclusive write locks are supported')
  const owner = elementChildren(root).find((child) => isElement(child, DAV_NAMESPACE, 'owner'))?.innerXml ?? ''
  return { owner }
}

export function davEtag(id: string, size: number, updatedAt: Date): string {
  return `"${id}-${size}-${updatedAt.getTime()}"`
}

export function xmlResponse(body: string, status: number, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', ...headers },
  })
}

function response(entry: DavEntry, request: PropfindRequest): string {
  const properties = requestedProperties(entry, request)
  const found = properties.filter((property) => propertyXml(entry, property))
  const missing = properties.filter((property) => !propertyXml(entry, property))
  const propstats = [
    found.length > 0 ? propstat(entry, found, 'HTTP/1.1 200 OK', request.mode === 'propname') : '',
    missing.length > 0 ? propstat(entry, missing, 'HTTP/1.1 404 Not Found', true) : '',
  ]
    .filter(Boolean)
    .join('\n')

  return `  <D:response>
    <D:href>${escapeXml(entry.href)}</D:href>
${propstats}
  </D:response>`
}

function propstat(entry: DavEntry, properties: DavPropertyName[], status: string, namesOnly: boolean): string {
  return `    <D:propstat>
      <D:prop>
${properties.map((property) => `        ${namesOnly ? emptyPropertyXml(property) : propertyXml(entry, property)}`).join('\n')}
      </D:prop>
      <D:status>${status}</D:status>
    </D:propstat>`
}

function requestedProperties(entry: DavEntry, request: PropfindRequest): DavPropertyName[] {
  if (request.mode === 'prop') return request.properties
  const all = [...livePropertyNames(), ...entry.deadProperties.map(({ namespace, name }) => ({ namespace, name }))]
  if (request.mode === 'propname') return uniqueProperties(all)
  return uniqueProperties([...all, ...request.include])
}

function livePropertyNames(): DavPropertyName[] {
  return [
    { namespace: DAV_NAMESPACE, name: 'displayname' },
    { namespace: DAV_NAMESPACE, name: 'creationdate' },
    { namespace: DAV_NAMESPACE, name: 'getetag' },
    { namespace: DAV_NAMESPACE, name: 'resourcetype' },
    { namespace: DAV_NAMESPACE, name: 'getcontentlength' },
    { namespace: DAV_NAMESPACE, name: 'getcontenttype' },
    { namespace: DAV_NAMESPACE, name: 'getlastmodified' },
    { namespace: DAV_NAMESPACE, name: 'supportedlock' },
    { namespace: DAV_NAMESPACE, name: 'lockdiscovery' },
  ]
}

function propertyXml(entry: DavEntry, property: DavPropertyName): string {
  if (property.namespace !== DAV_NAMESPACE) {
    return entry.deadProperties.find((dead) => sameProperty(dead, property))?.value ?? ''
  }
  switch (property.name) {
    case 'displayname':
      return `<D:displayname>${escapeXml(entry.displayName)}</D:displayname>`
    case 'creationdate':
      return `<D:creationdate>${entry.createdAt.toISOString()}</D:creationdate>`
    case 'getetag':
      return `<D:getetag>${escapeXml(entry.etag)}</D:getetag>`
    case 'resourcetype':
      return `<D:resourcetype>${entry.collection ? '<D:collection/>' : ''}</D:resourcetype>`
    case 'getcontentlength':
      return `<D:getcontentlength>${entry.contentLength}</D:getcontentlength>`
    case 'getcontenttype':
      return `<D:getcontenttype>${escapeXml(entry.contentType)}</D:getcontenttype>`
    case 'getlastmodified':
      return `<D:getlastmodified>${entry.updatedAt.toUTCString()}</D:getlastmodified>`
    case 'supportedlock':
      return `<D:supportedlock>
          <D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>
        </D:supportedlock>`
    case 'lockdiscovery':
      return `<D:lockdiscovery>
${entry.locks.map(activeLockXml).join('\n')}
        </D:lockdiscovery>`
    default:
      return ''
  }
}

function activeLockXml(lock: DavLock): string {
  return `        <D:activelock>
          <D:locktype><D:write/></D:locktype>
          <D:lockscope><D:exclusive/></D:lockscope>
          <D:depth>${escapeXml(lock.depth)}</D:depth>
          <D:owner>${lock.owner}</D:owner>
          <D:timeout>Second-${Math.max(0, Math.ceil((lock.expiresAt.getTime() - Date.now()) / 1000))}</D:timeout>
          <D:locktoken><D:href>${escapeXml(lock.token)}</D:href></D:locktoken>
        </D:activelock>`
}

function emptyPropertyXml(property: DavPropertyName): string {
  return property.namespace === DAV_NAMESPACE
    ? `<D:${property.name}/>`
    : `<Z:${property.name} xmlns:Z="${escapeXml(property.namespace)}"/>`
}

function uniqueProperties(properties: DavPropertyName[]): DavPropertyName[] {
  const seen = new Set<string>()
  return properties.filter((property) => {
    const key = `${property.namespace}\n${property.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameProperty(a: DavPropertyName, b: DavPropertyName): boolean {
  return a.namespace === b.namespace && a.name === b.name
}

interface XmlElement {
  namespace: string
  name: string
  prefix: string
  raw: string
  innerXml: string
  children: XmlElement[]
}

function parseXmlElement(xml: string): XmlElement {
  const source = xml.replace(/<\?xml[^>]*>/i, '').trim()
  const root: XmlElement = { namespace: '', name: '', prefix: '', raw: '', innerXml: '', children: [] }
  const stack: Array<XmlElement & { start: number; bodyStart: number; namespaces: Map<string, string> }> = [
    { ...root, start: 0, bodyStart: 0, namespaces: new Map([['D', DAV_NAMESPACE]]) },
  ]
  const tag =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/\s*([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\s*>|<\s*([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)([^>]*?)>/g
  let match = tag.exec(source)
  while (match) {
    if (match[0].startsWith('<!--') || match[0].startsWith('<?')) {
      match = tag.exec(source)
      continue
    }

    if (match[2]) {
      const current = stack.pop()
      if (!current || stack.length === 0) throw new Error('Invalid XML')
      const closePrefix = match[1]?.slice(0, -1) ?? ''
      if (current.prefix !== closePrefix || current.name !== match[2]) throw new Error('Invalid XML')
      current.raw = source.slice(current.start, match.index + match[0].length)
      current.innerXml = source.slice(current.bodyStart, match.index)
      stack.at(-1)?.children.push(current)
      match = tag.exec(source)
      continue
    }

    const prefix = match[3]?.slice(0, -1) ?? ''
    const name = match[4]
    const rawAttributes = match[5] ?? ''
    const selfClosing = /\/\s*$/.test(rawAttributes)
    const namespaces = new Map(stack.at(-1)?.namespaces)
    for (const ns of rawAttributes.matchAll(/\s+xmlns(?::([A-Za-z_][\w.-]*))?=["']([^"']+)["']/g)) {
      namespaces.set(ns[1] ?? '', ns[2])
    }
    const namespace = namespaces.get(prefix) ?? (prefix || namespaces.has('') ? '' : DAV_NAMESPACE)
    const element = {
      namespace,
      name,
      prefix,
      raw: selfClosing ? match[0] : '',
      innerXml: '',
      children: [],
      start: match.index,
      bodyStart: match.index + match[0].length,
      namespaces,
    }
    if (selfClosing) {
      stack.at(-1)?.children.push(element)
    } else {
      stack.push(element)
    }
    match = tag.exec(source)
  }
  if (stack.length !== 1 || stack[0].children.length !== 1) throw new Error('Invalid XML')
  return stack[0].children[0]
}

function requireElement(element: XmlElement, namespace: string, name: string): void {
  if (!isElement(element, namespace, name)) throw new Error(`Expected ${name}`)
}

function isElement(element: XmlElement, namespace: string, name: string): boolean {
  return element.namespace === namespace && element.name === name
}

function elementChildren(element: XmlElement): XmlElement[] {
  return element.children
}

function propertyNames(element: XmlElement): DavPropertyName[] {
  return elementChildren(element).map(toPropertyName)
}

function toPropertyName(element: XmlElement): DavPropertyName {
  return { namespace: element.namespace, name: element.name }
}

function propertyXmlWithNamespace(element: XmlElement): string {
  if (element.namespace === DAV_NAMESPACE) return element.raw
  const insertion = element.prefix
    ? ` xmlns:${element.prefix}="${escapeXml(element.namespace)}"`
    : ` xmlns="${escapeXml(element.namespace)}"`
  if (element.prefix) {
    if (element.raw.includes(`xmlns:${element.prefix}=`)) return element.raw
    return element.raw.replace(/(<[^\s>/]+)(\s|>|\/>)/, `$1${insertion}$2`)
  }
  if (element.raw.includes('xmlns=')) return element.raw
  return element.raw.replace(/(<[^\s>/]+)(\s|>|\/>)/, `$1${insertion}$2`)
}

function xmlDocument(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n${body}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
