import { describe, expect, it } from 'vitest'
import { cueTextFromPayload, safeMarkup } from './cue-text'

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

  it('keeps WebVTT text but drops tags other than i/b/u, and drops empty cues', () => {
    expect(cueTextFromPayload('vtt', '<v Bob>Hi</v> <b>there</b>')).toBe('Hi <b>there</b>')
    expect(cueTextFromPayload('srt', '  <font color=red> </font> ')).toBeNull()
  })
})

describe('safeMarkup', () => {
  // Vidstack copies <v> voices and <c> classes into attributes and renders through innerHTML.
  const onlyAllowedTags = (text: string) => text.replace(/<\/?[ibu]>/gi, '').includes('<') === false

  it.each([
    '<v a" onmouseover="alert(1)">Hi</v>',
    '<c.x" style="animation:x" onanimationstart="alert(1)">Hi</c>',
    '<<script>script>alert(1)<</script>/script>',
    '<i onclick="alert(1)">x</i>',
    '<img src=x onerror=alert(1)',
  ])('leaves no markup but bare <i>, <b>, <u> in %s', (input) => {
    expect(onlyAllowedTags(safeMarkup(input))).toBe(true)
  })

  it('keeps literal comparisons readable', () => {
    expect(safeMarkup('1 < 2 <i>ok</i>')).toBe('1 &lt; 2 <i>ok</i>')
  })
})
