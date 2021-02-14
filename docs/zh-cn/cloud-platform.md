> 这里我们列出了主流云平台的相关配置，仅供参考

## Endpoint

- 亚马逊S3：`s3.ap-northeast-1.amazonaws.com`
- 腾讯云COS：`cos.ap-shanghai.myqcloud.com`
- 阿里云OSS：`oss-cn-zhangjiakou.aliyuncs.com`
- 七牛云Kodo：`s3-cn-east-1.qiniucs.com`
- 谷歌云Storage：`storage.googleapis.com`

## CORS配置

- Origin: http://your-domain
- AllowMethods: PUT
- AllowHeaders: content-type,content-disposition,x-amz-acl

从v.1.5.0开始，在管理后台添加云存储配置的时候会自动进行CORS的设置。

但由于多数厂商兼容的S3协议API里并不包含CORS相关操作，所以CORS的设置每个厂商的情况都不一样。

目前支持的平台有：
- 阿里云OSS
- 腾讯云COS
- 七牛云Kodo
- UCloud（暂不支持自动设置CORS）
- 华为云OBS
- 网易云NOS（暂不支持自动设置CORS）
- 亚马逊S3
- MinIO
