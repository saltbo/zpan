import { nanoid } from 'nanoid'

const TEMPLATE = '$ORG_ID/$UID/$NOW_DATE/$RAND_16KEY$RAW_EXT'

export interface TemplateVars {
  uid: string
  orgId: string
  rawName: string
  rawExt: string
  uuid: string
}

export function buildObjectKey(vars: TemplateVars): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const date = `${year}${month}${day}`

  const replacements: Record<string, string> = {
    $UID: vars.uid,
    $ORG_ID: vars.orgId,
    $UUID: vars.uuid,
    $RAW_NAME: vars.rawName,
    $RAW_EXT: vars.rawExt,
    $NOW_DATE: date,
    $NOW_YEAR: year,
    $NOW_MONTH: month,
    $NOW_DAY: day,
    $RAND_16KEY: nanoid(16),
  }

  let result = TEMPLATE
  for (const [token, value] of Object.entries(replacements)) {
    result = result.replaceAll(token, value)
  }
  return result
}
