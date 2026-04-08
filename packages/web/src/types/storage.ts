export interface Storage {
  id: string
  uid: string
  title: string
  mode: 'private' | 'public'
  bucket: string
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  filePath: string
  customHost: string
  status: number
  createdAt: string
  updatedAt: string
}
