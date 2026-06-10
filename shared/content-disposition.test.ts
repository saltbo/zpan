import { describe, expect, it } from 'vitest'
import { attachmentContentDisposition } from './content-disposition'

const isLatin1 = (value: string) => [...value].every((ch) => ch.codePointAt(0)! <= 0xff)

describe('attachmentContentDisposition', () => {
  it('keeps ASCII filenames intact', () => {
    expect(attachmentContentDisposition('my file.jpg')).toBe(
      'attachment; filename="my file.jpg"; filename*=UTF-8\'\'my%20file.jpg',
    )
  })

  it('produces a header value that is safe for XMLHttpRequest.setRequestHeader (ISO-8859-1 only)', () => {
    const header = attachmentContentDisposition('测试文档.docx')
    expect(isLatin1(header)).toBe(true)
  })

  it('replaces non-ASCII chars in the plain filename and carries the real name in filename*', () => {
    expect(attachmentContentDisposition('测试文档.docx')).toBe(
      'attachment; filename="____.docx"; filename*=UTF-8\'\'%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3.docx',
    )
  })

  it('handles emoji in filenames', () => {
    const header = attachmentContentDisposition('🎉party.png')
    expect(isLatin1(header)).toBe(true)
    expect(header).toContain("filename*=UTF-8''")
  })

  it('neutralizes quotes and backslashes in the plain filename', () => {
    expect(attachmentContentDisposition('a"b\\c.txt')).toBe(
      'attachment; filename="a_b_c.txt"; filename*=UTF-8\'\'a%22b%5Cc.txt',
    )
  })
})
