> 这里我们提供了各大平台不同的endpoint样例，需要您把`my-zpan-bucket`改成您自己的bucket名称

# S3
### Endpoint
`endpoint: s3.my-zpan-bucket.amazonaws.com`

# COS
### Endpoint
`endpoint: cos.my-zpan-bucket.myqcloud.com`

# OSS
### Endpoint
`endpoint: oss.my-zpan-bucket.aliyuncs.com`

# Kodo
### Endpoint
`endpoint: s3-my-zpan-bucket.qiniucs.com`

# Storage
### Endpoint
`endpoint: storage.googleapis.com`

### CORS配置
```bash
echo '[{"origin":["*"],"method":["PUT"],"responseHeader":["content-type","x-amz-acl"]}]' > cors.json
gsutil cors set cors.json gs://your-bucket-name
```

