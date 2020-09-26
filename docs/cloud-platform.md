> Here we provide different endpoint samples for each major platform, you need to change `my-zpan-bucket` to your own bucket name

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

### CORS
```bash
echo '[{"origin":["*"],"method":["PUT"],"responseHeader":["content-type","x-amz-acl"]}]' > cors.json
gsutil cors set cors.json gs://your-bucket-name
```

