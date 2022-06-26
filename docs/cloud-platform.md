## S3协议平台

- 阿里云OSS
- 腾讯云COS
- 七牛云Kodo
- UCloud（需手动自动设置CORS）
- 华为云OBS
- 网易云NOS（需手动自动设置CORS）
- 亚马逊S3
- MinIO

> 路径：管理后台-存储管理-创建存储

### 基础配置

<img src="/static/images/cloud-platform/image-20210712165603221.png" alt="image-20210712165603221" style="zoom:50%;" />

1. 网盘和外链盘的区别是：外链盘可以直接拿到永久外链，同时它没有分享和回收站的功能
2. 名称是在zpan中该存储的名字，同时也是路由地址，所以只支持英文
3. 云平台的数据来源于 https://github.com/eplist/eplist ，欢迎PR
4. 接入点的数据同样源于eplist，选择一个云平台后会自动给出该平台的所有Endpoint

### 高级配置

![image-20210712170751044](/static/images/cloud-platform/image-20210712170751044.png)

1. 高级配置默认都可为空
2. 标题可以是中文，用于在页面顶部的导航栏显示
3. 自有域名即用来访问/下载资源的域名
4. 存储根路径指的是在云存储里的存储路径，默认是根目录，指定一个前缀，可以实现共用一个bucket的场景
5. 文件存储路径指的是上传的文件在云存储里的存储路径，默认是$NOW_DATE/$RAND_16KEY.$RAW_EXT
6. 可以看到我们支持一些系统变量，通过这些变量你可以设置自己的路径规则

### CORS配置

- Origin: http://your-domain
- AllowMethods: PUT
- AllowHeaders: content-type,content-disposition,x-amz-acl



## MinIO

基于MinIO可以快速搭建自己的私有云。

需要注意的是，我们仅支持Virtual Hosted-Style模式的S3协议，所以在MinIO搭建时需要注意开启Virtual Hosted-Style。

启用的方式很简单，即设置环境变量MINIO_DOMAIN=endpoint.example.com

当您创建一个bucket名叫zpan时，它的完整域名是zpan.endpoint.example.com

但是，注意，**zpan中需要您填写的接入点是不包含bucket的，所以您应该填写endpoint.example.com**



#### 参考文档：

- https://docs.min.io/docs/minio-server-configuration-guide.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAPI.html





## 又拍云

!> 又拍云不兼容s3协议，所以和其他平台有一些区别，需要特别注意

1. Endpoint填写又拍云默认分配的加速域名（仅供测试那个）
2. AccessKey为操作员名称，AccessSecret为操作员密码
3. **如果是网盘类型，需要将Token防盗链的秘钥设置为操作员的密码**

![image-20210712172027775](/static/images/cloud-platform/image-20210712172027775.png)![image-20210712172346760](/static/images/cloud-platform/image-20210712172346760.png)

![image-20210712172707803](/static/images/cloud-platform/image-20210712172707803.png)