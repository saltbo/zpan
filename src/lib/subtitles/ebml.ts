export interface EbmlElement {
  id: number
  /** Absolute offset of the element's ID. */
  offset: number
  headerSize: number
  /** Null when the muxer wrote an unknown size (live-style Segment/Cluster). */
  size: number | null
}

export interface EbmlChild extends EbmlElement {
  /** Offset of the element's data inside the buffer it was read from. */
  dataStart: number
}

// IDs keep their length marker bits, matching how the Matroska spec writes them (e.g. 0x1A45DFA3).
export function readId(bytes: Uint8Array, pos: number): { id: number; length: number } | null {
  const first = bytes[pos]
  if (first === undefined) return null
  const length = Math.clz32(first) - 23
  if (length < 1 || length > 4 || pos + length > bytes.length) return null
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + bytes[pos + i]
  return { id, length }
}

export function readVint(bytes: Uint8Array, pos: number): { value: number | null; length: number } | null {
  const first = bytes[pos]
  if (first === undefined || first === 0) return null
  const length = Math.clz32(first) - 23
  if (pos + length > bytes.length) return null
  let value = first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i++) {
    const byte = bytes[pos + i]
    value = value * 256 + byte
    allOnes &&= byte === 0xff
  }
  return { value: allOnes ? null : value, length }
}

/** Reads an element header at `pos`; `base` is the absolute offset of `bytes[0]`. */
export function readElementHeader(bytes: Uint8Array, pos: number, base = 0): EbmlElement | null {
  const id = readId(bytes, pos)
  if (!id) return null
  const size = readVint(bytes, pos + id.length)
  if (!size) return null
  return { id: id.id, offset: base + pos, headerSize: id.length + size.length, size: size.value }
}

/** Children of a fully loaded master element body. Stops at a truncated or unknown-size child. */
export function* children(bytes: Uint8Array, start = 0, end = bytes.length): Generator<EbmlChild> {
  let pos = start
  while (pos < end) {
    const header = readElementHeader(bytes, pos)
    if (!header || header.size === null) return
    const dataStart = pos + header.headerSize
    if (dataStart + header.size > end) return
    yield { ...header, dataStart }
    pos = dataStart + header.size
  }
}

export function readUint(bytes: Uint8Array, start: number, size: number): number {
  let value = 0
  for (let i = 0; i < size; i++) value = value * 256 + bytes[start + i]
  return value
}

const utf8 = new TextDecoder()

export function readString(bytes: Uint8Array, start: number, size: number): string {
  return utf8.decode(bytes.subarray(start, start + size)).replace(/\0+$/, '')
}
