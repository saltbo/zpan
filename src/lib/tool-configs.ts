// Pure functions that build config fields for tool integrations.
// PicGo and uPic return field lists (for GUI field-by-field entry).
// ShareX returns a downloadable .sxcu JSON.

export interface ToolConfigParams {
  appHost: string
  userKey: string
}

// Each field maps to a GUI input in the tool's settings panel.
export interface ToolConfigField {
  label: string
  value: string
}

export function buildPicGoFields(params: ToolConfigParams): ToolConfigField[] {
  const { appHost, userKey } = params
  return [
    { label: 'API地址 (URL)', value: `${appHost}/api/ihost/images` },
    { label: 'POST参数名 (paramName)', value: 'file' },
    { label: 'JSON路径 (jsonPath)', value: 'data.url' },
    { label: '自定义请求头 (customHeader)', value: JSON.stringify({ Authorization: `Bearer ${userKey}` }) },
  ]
}

export function buildUPicFields(params: ToolConfigParams): ToolConfigField[] {
  const { appHost, userKey } = params
  return [
    { label: 'API 地址 (URL)', value: `${appHost}/api/ihost/images` },
    { label: '请求方式 (Method)', value: 'POST' },
    { label: '文件字段名 (File Field)', value: 'file' },
    { label: '请求头 (Header Name)', value: 'Authorization' },
    { label: '请求头 (Header Value)', value: `Bearer ${userKey}` },
    { label: 'URL 路径 (Response URL Path)', value: '["data", "url"]' },
  ]
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
    URL: '{json:data.url}',
    ErrorMessage: '{json:error}',
  }
}

export function buildShareXConfigString(params: ToolConfigParams): string {
  return JSON.stringify(buildShareXConfig(params), null, 2)
}
