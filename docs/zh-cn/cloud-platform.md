> 这里我们列出了主流云平台的相关配置，仅供参考

# Endpoint

- 亚马逊S3：`s3.ap-northeast-1.amazonaws.com`
- 腾讯云COS：`cos.ap-shanghai.myqcloud.com`
- 阿里云OSS：`oss-cn-zhangjiakou.aliyuncs.com`
- 七牛云Kodo：`s3-cn-east-1.qiniucs.com`
- 谷歌云Storage：`storage.googleapis.com`

# CORS配置

- origin: http://your-domain
- AllowMethods: PUT
- AllowHeaders: content-type,content-disposition,x-amz-acl

### S3
s3的权限比较复杂，我还没有进行详细的测试，目前我是直接将`阻止通过新访问控制列表(ACL)授予的对存储桶和对象的公开访问`这个选项关闭；然后将下面的CORS配置填写并保存即可。
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
由于谷歌云Storage没有提供可视化配置界面，只提供了一个命令行工具，所以我们可以利用CloudShell进行操作，具体命令如下：
```bash
echo '[{"origin":["*"],"method":["PUT"],"responseHeader":["content-type","content-disposition","x-amz-acl"]}]' > cors.json
gsutil cors set cors.json gs://your-bucket-name
```

### 其他
OSS、COS、Kodo之类的可视化做的都很好，就不废话了，如果实在不会弄可以看[白话文教程](/zh-cn/vernacular)