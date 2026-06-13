import { nanoid } from 'nanoid'

export interface TemplateVars {
  uid: string
  orgId: string
  rawExt: string
}

/** Returns the file extension including the leading dot, or '' when there is none. */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

export function buildObjectKey(vars: TemplateVars): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${vars.orgId}/${vars.uid}/${year}${month}${day}/${nanoid(16)}${vars.rawExt}`
}
