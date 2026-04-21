// Pure functions that build config strings/JSON for tool integrations.
// No side effects. Suitable for snapshot testing.

const PLACEHOLDER_KEY = '<userKey>'

export interface ToolConfigParams {
  appHost: string
  userKey: string
}

export function buildPicGoConfig(params: ToolConfigParams): string {
  const { appHost, userKey } = params
  const config = {
    url: `${appHost}/api/ihost/images`,
    paramName: 'file',
    jsonPath: 'data.url',
    customHeader: JSON.stringify({ Authorization: `Bearer ${userKey}` }),
    customBody: JSON.stringify({ path: '{year}/{month}/{fileName}' }),
  }
  return JSON.stringify(config, null, 2)
}

export function buildUPicConfig(params: ToolConfigParams): string {
  const { appHost, userKey } = params
  const config = {
    type: 'custom',
    url: `${appHost}/api/ihost/images`,
    fileFormData: 'file',
    headers: { Authorization: `Bearer ${userKey}` },
    body: { path: '{year}/{month}/{filename}.{ext}' },
    responseField: 'data.url',
  }
  return JSON.stringify(config, null, 2)
}

export function buildShareXConfig(params: ToolConfigParams): object {
  const { appHost, userKey } = params
  return {
    Version: '15.0.0',
    Name: 'ZPan Image Host',
    DestinationType: 'ImageUploader, FileUploader',
    RequestMethod: 'POST',
    RequestURL: `${appHost}/api/ihost/images`,
    Headers: { Authorization: `Bearer ${userKey}` },
    Body: 'MultipartFormData',
    FileFormName: 'file',
    Arguments: { path: '%y/%mo/$filename$' },
    URL: '{json:data.url}',
    ErrorMessage: '{json:error}',
  }
}

export function buildShareXConfigString(params: ToolConfigParams): string {
  return JSON.stringify(buildShareXConfig(params), null, 2)
}

export function buildFlameshotScript(params: ToolConfigParams): string {
  const { appHost, userKey } = params
  return [
    `IHOST_KEY="${userKey}"`,
    'flameshot gui --raw | curl \\',
    '  -H "Authorization: Bearer $IHOST_KEY" \\',
    '  -F "file=@-" \\',
    `  -F "path=screenshots/$(date +%Y/%m)/$(date +%s).png" \\`,
    `  ${appHost}/api/ihost/images \\`,
    "  | jq -r '.data.url' | xclip -selection clipboard",
  ].join('\n')
}

export function defaultParams(userKey?: string): ToolConfigParams {
  return {
    appHost: typeof window !== 'undefined' ? window.location.origin : '',
    userKey: userKey ?? PLACEHOLDER_KEY,
  }
}
