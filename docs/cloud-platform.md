> Here we provide different endpoint samples for each major platform, you need to change `my-zpan-bucket` to your own bucket name

## Endpoint

- AmazonS3：`s3.ap-northeast-1.amazonaws.com`
- TencentCOS：`cos.ap-shanghai.myqcloud.com`
- AliyunOSS：`oss-cn-zhangjiakou.aliyuncs.com`
- QiniuKodo：`s3-cn-east-1.qiniucs.com`
- GoogleStorage：`storage.googleapis.com`

## CORS

- Origin: http://your-domain
- AllowMethods: PUT
- AllowHeaders: content-type,content-disposition,x-amz-acl

### S3
The permissions of s3 are more complicated, and I have not conducted detailed tests. At present, I directly turn off the option of `Block public access to buckets and objects granted through new access control lists (ACLs)`; then configure the following CORS Just fill in and save.
```json
[
    {
        "AllowedOrigins": [
            "http://your-domain"
        ],
        "AllowedMethods": [
            "PUT"
        ],
        "AllowedHeaders": [
            "content-type",
            "content-disposition",
            "x-amz-acl"
        ],
        "ExposeHeaders": []
    }
]
```

### Storage
Since Google Cloud Storage does not provide a visual configuration interface, only a command line tool, so we can use CloudShell to operate, the specific commands are as follows:
```bash
echo '[{"origin":["*"],"method":["PUT"],"responseHeader":["content-type","content-disposition","x-amz-acl"]}]' > cors.json
gsutil cors set cors.json gs://your-bucket-name
```

### Others
OSS, COS, Kodo and other visualizations are all very good, so don’t talk nonsense, if you really don’t know how to do it, you can watch [Vernacular](/vernacular)