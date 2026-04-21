import { describe, expect, it } from 'vitest'
import { buildPicGoFields, buildShareXConfig, buildShareXConfigString, buildUPicFields } from './tool-configs'

const paramsWithKey = { appHost: 'https://zpan.example.com', userKey: 'test-key-123' }
const paramsNoKey = { appHost: 'https://zpan.example.com', userKey: '<userKey>' }

describe('buildPicGoFields', () => {
  it('returns 4 fields for picgo-plugin-web-uploader GUI', () => {
    const fields = buildPicGoFields(paramsWithKey)
    expect(fields).toHaveLength(4)
  })

  it('includes URL, paramName, jsonPath, and customHeader', () => {
    const fields = buildPicGoFields(paramsWithKey)
    const labels = fields.map((f) => f.label)
    expect(labels).toContain('API地址 (URL)')
    expect(labels).toContain('POST参数名 (paramName)')
    expect(labels).toContain('JSON路径 (jsonPath)')
    expect(labels).toContain('自定义请求头 (customHeader)')
  })

  it('injects appHost into URL field', () => {
    const fields = buildPicGoFields(paramsWithKey)
    const urlField = fields.find((f) => f.label.includes('URL'))
    expect(urlField?.value).toBe('https://zpan.example.com/api/ihost/images')
  })

  it('injects userKey into customHeader', () => {
    const fields = buildPicGoFields(paramsWithKey)
    const headerField = fields.find((f) => f.label.includes('customHeader'))
    expect(headerField?.value).toContain('test-key-123')
  })

  it('uses placeholder when key is not set', () => {
    const fields = buildPicGoFields(paramsNoKey)
    const headerField = fields.find((f) => f.label.includes('customHeader'))
    expect(headerField?.value).toContain('<userKey>')
  })
})

describe('buildUPicFields', () => {
  it('returns 6 fields for uPic Custom Host GUI', () => {
    const fields = buildUPicFields(paramsWithKey)
    expect(fields).toHaveLength(6)
  })

  it('includes URL, method, file field, header name/value, and response URL path', () => {
    const fields = buildUPicFields(paramsWithKey)
    const labels = fields.map((f) => f.label)
    expect(labels).toContain('API 地址 (URL)')
    expect(labels).toContain('请求方式 (Method)')
    expect(labels).toContain('文件字段名 (File Field)')
    expect(labels).toContain('请求头 (Header Name)')
    expect(labels).toContain('请求头 (Header Value)')
    expect(labels).toContain('URL 路径 (Response URL Path)')
  })

  it('header value uses Bearer format', () => {
    const fields = buildUPicFields(paramsWithKey)
    const headerValue = fields.find((f) => f.label.includes('Header Value'))
    expect(headerValue?.value).toBe('Bearer test-key-123')
  })

  it('response URL path uses array notation', () => {
    const fields = buildUPicFields(paramsWithKey)
    const urlPath = fields.find((f) => f.label.includes('Response URL Path'))
    expect(urlPath?.value).toBe('["data", "url"]')
  })

  it('uses placeholder when key is not set', () => {
    const fields = buildUPicFields(paramsNoKey)
    const headerValue = fields.find((f) => f.label.includes('Header Value'))
    expect(headerValue?.value).toContain('<userKey>')
  })
})

describe('buildShareXConfig', () => {
  it('returns a plain object', () => {
    const result = buildShareXConfig(paramsWithKey)
    expect(typeof result).toBe('object')
    expect(result).not.toBeNull()
  })

  it('matches snapshot with key', () => {
    expect(buildShareXConfig(paramsWithKey)).toMatchInlineSnapshot(`
      {
        "Body": "MultipartFormData",
        "DestinationType": "ImageUploader, FileUploader",
        "ErrorMessage": "{json:error}",
        "FileFormName": "file",
        "Headers": {
          "Authorization": "Bearer test-key-123",
        },
        "Name": "ZPan Image Host",
        "RequestMethod": "POST",
        "RequestURL": "https://zpan.example.com/api/ihost/images",
        "URL": "{json:data.url}",
        "Version": "15.0.0",
      }
    `)
  })

  it('serialises to valid JSON string', () => {
    const str = buildShareXConfigString(paramsWithKey)
    expect(() => JSON.parse(str)).not.toThrow()
  })

  it('uses placeholder when key is not set', () => {
    const str = buildShareXConfigString(paramsNoKey)
    expect(str).toContain('<userKey>')
  })
})
