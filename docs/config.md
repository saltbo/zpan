# debug
Whether to output the debug log, the default is false

# invitation
Whether invitation registration is enabled, after enabling, only invitation registration is allowed, and it is disabled by default

# storage
The initial space allocated to each user, default 50 megabytes, unit: byte

# database
The database driver of ZPan is defined here

## driver 
We support four database drivers, you can choose according to your needs

- sqlite3
- mysql
- postgres
- mssql

## dsn
The dsn corresponding to different drivers is also different, here we give the dsn format of each driver separately

|  driver   | dsn  |
|  ----  | ----  |
| sqlite3  | zpan.db |
| mysql  | user:pass@tcp(127.0.0.1:3306)/zpan?charset=utf8mb4&parseTime=True&loc=Local |
| postgres  | user=zpan password=zpan dbname=zpan port=9920 sslmode=disable TimeZone=Asia/Shanghai |
| mssql  | sqlserver://zpan:LoremIpsum86@localhost:9930?database=zpan |

# provider
Currently we support all S3-based cloud storage platforms, such as Alibaba Cloud OSS, Tencent Cloud COS, Qiniu Cloud KODO.

## name
The name of the cloud storage you use, the options are as follows

- oss
- cos
- kodo

## bucket
The name of the storage space you created

## endpoint
Access point for cloud storage

## customHost
Custom domain name bound to cloud storage

## accessKey

## accessSecret

# email
Configure the email address to open the account registration email verification

## host
Mailing service address，eg:: smtpdm.aliyun.com:25

## sender: 
Mailing address，eg:no-reply@saltbo.fun

## username
Sender，eg：Zpan

## password
Sending password

