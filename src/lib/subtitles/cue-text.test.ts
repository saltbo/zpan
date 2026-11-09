import { describe, expect, it } from 'vitest'
import { cueTextFromPayload } from './cue-text'

describe('cueTextFromPayload', () => {
  it('keeps the WebVTT-compatible SRT markup and drops the rest', () => {
    expect(cueTextFromPayload('srt', '第一句 <i>斜体</i> <font color="#ff0000">红</font>')).toBe(
      '第一句 <i>斜体</i> 红',
    )
    expect(cueTextFromPayload('srt', '{\\an8}Top & <b>bold</b>')).toBe('Top &amp; <b>bold</b>')
  })

  it('normalizes Windows line endings', () => {
    expect(cueTextFromPayload('srt', '第二句\r\n两行')).toBe('第二句\n两行')
  })

  it('takes the text field of an ASS event and strips override tags', () => {
    expect(cueTextFromPayload('ass', '0,0,Default,,0,0,0,,{\\b1}粗体{\\b0}, 逗号\\N第二行')).toBe('粗体, 逗号\n第二行')
    expect(cueTextFromPayload('ass', '2,0,Default,,0,0,0,,a<b>&c\\hd')).toBe('a&lt;b&gt;&amp;c d')
  })

  it('skips ASS vector drawings and malformed events', () => {
    expect(cueTextFromPayload('ass', '1,0,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}')).toBeNull()
    expect(cueTextFromPayload('ass', 'not,an,event')).toBeNull()
  })

  it('passes WebVTT cue text through and drops empty cues', () => {
    expect(cueTextFromPayload('vtt', '<v Bob>Hi</v>')).toBe('<v Bob>Hi</v>')
    expect(cueTextFromPayload('srt', '  <font color=red> </font> ')).toBeNull()
  })
})
