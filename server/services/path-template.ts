import { nanoid } from 'nanoid'

export interface TemplateVars {
  uid: string
  orgId: string
  rawExt: string
}

export function buildObjectKey(vars: TemplateVars): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${vars.orgId}/${vars.uid}/${year}${month}${day}/${nanoid(16)}${vars.rawExt}`
}
