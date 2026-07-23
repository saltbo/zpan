export interface NfoField {
  name: string
  values: string[]
}

export interface NfoSection {
  name: string
  fields: NfoField[]
}

export type NfoDocument =
  | {
      format: 'xml'
      root: string
      sections: NfoSection[]
    }
  | {
      format: 'mediainfo'
      sections: NfoSection[]
    }
  | {
      format: 'text'
      content: string
    }

function elementChildren(element: Element): Element[] {
  return Array.from(element.children)
}

function elementLabel(element: Element): string {
  const discriminator = element.getAttribute('type') ?? element.getAttribute('name') ?? element.getAttribute('aspect')
  return discriminator ? `${element.tagName} (${discriminator})` : element.tagName
}

function addField(fields: Map<string, string[]>, name: string, value: string): void {
  const normalized = value.trim()
  if (!normalized) return

  const values = fields.get(name) ?? []
  if (!values.includes(normalized)) values.push(normalized)
  fields.set(name, values)
}

function collectXmlFields(element: Element, fields: Map<string, string[]>, prefix = ''): void {
  for (const child of elementChildren(element)) {
    const label = elementLabel(child)
    const name = prefix ? `${prefix} › ${label}` : label
    const children = elementChildren(child)

    if (children.length === 0) {
      addField(fields, name, child.textContent ?? '')
    } else {
      collectXmlFields(child, fields, name)
    }
  }
}

function fieldsFromMap(fields: Map<string, string[]>): NfoField[] {
  return Array.from(fields, ([name, values]) => ({ name, values }))
}

function parseXmlNfo(content: string): NfoDocument | null {
  const document = new DOMParser().parseFromString(content, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) return null

  const root = document.documentElement
  if (!root) return null

  const overview = new Map<string, string[]>()
  const sectionFields = new Map<string, Map<string, string[]>>()

  for (const child of elementChildren(root)) {
    const children = elementChildren(child)
    if (children.length === 0) {
      addField(overview, elementLabel(child), child.textContent ?? '')
      continue
    }

    const sectionName = child.tagName
    const fields = sectionFields.get(sectionName) ?? new Map<string, string[]>()
    collectXmlFields(child, fields)
    sectionFields.set(sectionName, fields)
  }

  const sections: NfoSection[] = []
  if (overview.size > 0) sections.push({ name: root.tagName, fields: fieldsFromMap(overview) })
  for (const [name, fields] of sectionFields) {
    sections.push({ name, fields: fieldsFromMap(fields) })
  }

  return { format: 'xml', root: root.tagName, sections }
}

function parseMediaInfoNfo(content: string): NfoDocument | null {
  const sections: NfoSection[] = []
  let current: NfoSection | null = null

  for (const line of content.split(/\r?\n/)) {
    const field = line.match(/^([^:]+?)\s+:\s*(.*)$/)
    if (field && current) {
      const [, name, value] = field
      if (name && value) current.fields.push({ name: name.trim(), values: [value.trim()] })
      continue
    }

    const sectionName = line.trim()
    if (sectionName && !line.includes(':')) {
      current = { name: sectionName, fields: [] }
      sections.push(current)
    }
  }

  const populatedSections = sections.filter((section) => section.fields.length > 0)
  if (populatedSections.length === 0 || !populatedSections.some((section) => section.name === 'General')) return null
  return { format: 'mediainfo', sections: populatedSections }
}

export function parseNfo(content: string): NfoDocument {
  const trimmed = content.trim()
  if (trimmed.startsWith('<')) {
    const xml = parseXmlNfo(trimmed)
    if (xml) return xml
  }

  const mediaInfo = parseMediaInfoNfo(content)
  if (mediaInfo) return mediaInfo

  return { format: 'text', content }
}
