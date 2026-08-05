import { generateToken, OPAQUE_ID_PATTERN } from '../../shared/ids'

export interface TemplateVars {
  uid: string
  orgId: string
  rawExt: string
}

function requireOpaqueIdKeyComponent(keyType: string, name: string, value: string): void {
  if (!OPAQUE_ID_PATTERN.test(value)) throw new Error(`Invalid ${name} for ${keyType} storage key`)
}

export function assertObjectKeyOwner(vars: Pick<TemplateVars, 'orgId' | 'uid'>): void {
  requireOpaqueIdKeyComponent('object', 'organization ID', vars.orgId)
  requireOpaqueIdKeyComponent('object', 'user ID', vars.uid)
}

/** Returns the file extension including the leading dot, or '' when there is none. */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

export function buildObjectKey(vars: TemplateVars): string {
  assertObjectKeyOwner(vars)

  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${vars.orgId}/${vars.uid}/${year}${month}${day}/${generateToken(17)}${vars.rawExt}`
}

export function buildImageStorageKey(orgId: string, imageId: string, extension: string): string {
  requireOpaqueIdKeyComponent('image', 'organization ID', orgId)
  requireOpaqueIdKeyComponent('image', 'image ID', imageId)
  if (!/^[A-Za-z0-9]+$/.test(extension)) throw new Error('Invalid extension for image storage key')
  return `ih/${orgId}/${imageId}.${extension}`
}
