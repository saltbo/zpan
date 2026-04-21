import { describe, expect, it } from 'vitest'
import {
  buildFlameshotScript,
  buildPicGoConfig,
  buildShareXConfig,
  buildShareXConfigString,
  buildUPicConfig,
} from './tool-configs'

const paramsWithKey = { appHost: 'https://zpan.example.com', userKey: 'test-key-123' }
const paramsNoKey = { appHost: 'https://zpan.example.com', userKey: '<userKey>' }

describe('buildPicGoConfig', () => {
  it('produces valid JSON', () => {
    const result = buildPicGoConfig(paramsWithKey)
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('matches snapshot with key', () => {
    expect(buildPicGoConfig(paramsWithKey)).toMatchInlineSnapshot(`
      "{
        "url": "https://zpan.example.com/api/ihost/images",
        "paramName": "file",
        "jsonPath": "data.url",
        "customHeader": "{\\"Authorization\\":\\"Bearer test-key-123\\"}"
      }"
    `)
  })

  it('uses placeholder when key is not set', () => {
    const result = buildPicGoConfig(paramsNoKey)
    expect(result).toContain('<userKey>')
  })

  it('injects appHost into url field', () => {
    const parsed = JSON.parse(buildPicGoConfig(paramsWithKey))
    expect(parsed.url).toBe('https://zpan.example.com/api/ihost/images')
  })
})

describe('buildUPicConfig', () => {
  it('produces valid JSON', () => {
    const result = buildUPicConfig(paramsWithKey)
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('matches snapshot with key', () => {
    expect(buildUPicConfig(paramsWithKey)).toMatchInlineSnapshot(`
      "{
        "type": "custom",
        "method": "POST",
        "url": "https://zpan.example.com/api/ihost/images",
        "fileFormData": "file",
        "headers": {
          "Authorization": "Bearer test-key-123"
        },
        "body": {
          "path": "{filename}"
        },
        "responseURL": [
          "data",
          "url"
        ]
      }"
    `)
  })

  it('uses placeholder when key is not set', () => {
    const result = buildUPicConfig(paramsNoKey)
    expect(result).toContain('<userKey>')
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

describe('buildFlameshotScript', () => {
  it('contains the upload URL', () => {
    const result = buildFlameshotScript(paramsWithKey)
    expect(result).toContain('https://zpan.example.com/api/ihost/images')
  })

  it('contains the key', () => {
    const result = buildFlameshotScript(paramsWithKey)
    expect(result).toContain('test-key-123')
  })

  it('matches snapshot with key', () => {
    expect(buildFlameshotScript(paramsWithKey)).toMatchInlineSnapshot(`
      "IHOST_KEY="test-key-123"
      flameshot gui --raw | curl \\
        -H "Authorization: Bearer $IHOST_KEY" \\
        -F "file=@-" \\
        -F "path=screenshots/$(date +%Y/%m)/$(date +%s).png" \\
        https://zpan.example.com/api/ihost/images \\
        | jq -r '.data.url' | xclip -selection clipboard"
    `)
  })

  it('uses placeholder when key is not set', () => {
    const result = buildFlameshotScript(paramsNoKey)
    expect(result).toContain('<userKey>')
  })
})
