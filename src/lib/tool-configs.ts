// Pure functions that build config strings/JSON for tool integrations.
// No side effects. Suitable for snapshot testing.

export interface ToolConfigParams {
  appHost: string
  userKey: string
}

export function buildPicGoConfig(params: ToolConfigParams): string {
  const { appHost, userKey } = params
  // picgo-plugin-web-uploader sends customBody fields literally (no template
  // expansion), so we omit customBody — the server defaults path to the
  // original filename, which is the safest option for PicGo.
  const config = {
    url: `${appHost}/api/ihost/images`,
    paramName: 'file',
    jsonPath: 'data.url',
    customHeader: JSON.stringify({ Authorization: `Bearer ${userKey}` }),
  }
  return JSON.stringify(config, null, 2)
}

export function buildUPicConfig(params: ToolConfigParams): string {
  const { appHost, userKey } = params
  // uPic Custom Host reference — must be configured manually in the GUI.
  // Body "extension fields" only support {filename} as a dynamic template.
  // URL path uses array notation ["data", "url"] to extract from response JSON.
  const config = {
    type: 'custom',
    method: 'POST',
    url: `${appHost}/api/ihost/images`,
    fileFormData: 'file',
    headers: { Authorization: `Bearer ${userKey}` },
    body: { path: '{filename}' },
    responseURL: ['data', 'url'],
  }
  return JSON.stringify(config, null, 2)
}

export function buildShareXConfig(params: ToolConfigParams): object {
  const { appHost, userKey } = params
  // ShareX custom uploader syntax: {filename} for the file name.
  // Date variables are not supported in Arguments — the server defaults
  // path to the original filename when omitted.
  return {
    Version: '15.0.0',
    Name: 'ZPan Image Host',
    DestinationType: 'ImageUploader, FileUploader',
    RequestMethod: 'POST',
    RequestURL: `${appHost}/api/ihost/images`,
    Headers: { Authorization: `Bearer ${userKey}` },
    Body: 'MultipartFormData',
    FileFormName: 'file',
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
