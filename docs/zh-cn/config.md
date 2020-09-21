## 配置文件

默认路径：/etc/zpan/zpan.yml

```yaml
debug: false
invitation: false  # 邀请注册是否开启，开启后只允许邀请注册，默认关闭
storage: 104857600 # 给每个用户分配的初始空间，单位：字节

database:
  driver: mysql
  dsn: root:admin@tcp(127.0.0.1:3306)/zpan?charset=utf8&parseTime=True&loc=Local

provider:
  name: oss
  bucket: saltbo-zpan-test
  endpoint: https://oss-cn-zhangjiakou.aliyuncs.com
  customHost: http://dl-test.saltbo.cn
  accessKey: LTAIxxxxxxxxxxxxxxx7YoV
  accessSecret: PFGVwxxxxxxxxxxxxxxxxRd09u

#配置发信邮箱即可开启账号注册的邮箱验证
#email:
#  host: smtpdm.aliyun.com:25
#  sender: no-reply@saltbo.fun
#  username: Zpan
#  password: mGxxxxxxxxh9
```

## Database

我们采用GORM进行数据库操作，因此我们支持MySQL, PostgreSQL, SQlite, SQL Server四种数据库驱动。在默认配置中我们使用SQlite作为数据库，如果您想使用其他数据库，只需要将driver改为相应驱动名称即可。

### driver & dsn

- sqlite3: zpan.db
- mysql: user:pass@tcp(127.0.0.1:3306)/zpan?charset=utf8mb4&parseTime=True&loc=Local
- postgres: user=zpan password=zpan dbname=zpan port=9920 sslmode=disable TimeZone=Asia/Shanghai
- mssql: sqlserver://zpan:LoremIpsum86@localhost:9930?database=zpan


## Provider

目前我们支持所有基于S3的云存储平台，比如阿里云OSS、腾讯云COS、七牛云KODO。

因此，Provider的name可配置为下面这些选项：

- oss
- cos
- kodo

其他参数当您在对应平台上创建完bucket就可以拿到了，配置到响应位置即可。

