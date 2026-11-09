import type { TextSubtitleFormat } from './mkv'

// Fields before Text in a Matroska ASS/SSA block: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect.
const ASS_FIELDS_BEFORE_TEXT = 8

/** Converts a Matroska subtitle block payload to WebVTT cue text, or null when nothing displayable remains. */
export function cueTextFromPayload(format: TextSubtitleFormat, payload: string): string | null {
  const normalized = payload.replace(/\r\n?/g, '\n')
  const text = format === 'ass' ? assText(normalized) : format === 'srt' ? srtText(normalized) : safeMarkup(normalized)
  if (text === null) return null
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

function assText(payload: string): string | null {
  let index = -1
  for (let i = 0; i < ASS_FIELDS_BEFORE_TEXT; i++) {
    index = payload.indexOf(',', index + 1)
    if (index === -1) return null
  }
  const text = payload.slice(index + 1)
  // \p1 and up switch the line to vector drawing commands, which aren't readable text.
  if (/\{[^}]*\\p[1-9]/.test(text)) return null
  return escapeCueText(text.replace(/\{[^}]*\}/g, ''))
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
}

function srtText(payload: string): string {
  // ASS-style positioning ({\an8}) is common in SRT files and means nothing to WebVTT.
  return safeMarkup(payload.replace(/\{\\[^}]*\}/g, '').replace(/&/g, '&amp;'))
}

/**
 * Vidstack renders cue text through innerHTML and copies WebVTT tag annotations (<v name>, <c.class>)
 * into attributes unescaped, so a subtitle file someone shared could inject markup. Only bare <i>, <b>
 * and <u> survive: every other "<" is escaped, then the tags it opened (<font>, <v>…) are dropped.
 */
export function safeMarkup(text: string): string {
  return text.replace(/<(?!\/?[ibu]>)/gi, '&lt;').replace(/&lt;\/?[a-z][^>\n]*>/gi, '')
}

function escapeCueText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
