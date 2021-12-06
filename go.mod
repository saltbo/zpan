module github.com/saltbo/zpan

// +heroku goVersion go1.16
go 1.16

require (
	github.com/alecthomas/template v0.0.0-20190718012654-fb15b899a751
	github.com/aliyun/aliyun-oss-go-sdk v2.1.6+incompatible
	github.com/aws/aws-sdk-go v1.34.14
	github.com/baiyubin/aliyun-sts-go-sdk v0.0.0-20180326062324-cfa1a18b161f // indirect
	github.com/gin-contrib/gzip v0.0.3
	github.com/gin-gonic/gin v1.7.0
	github.com/go-oauth2/oauth2/v4 v4.4.1
	github.com/golang-jwt/jwt v3.2.2+incompatible
	github.com/google/uuid v1.1.1
	github.com/saltbo/gopkg v0.0.0-20210807060851-127038a22f0d
	github.com/satori/go.uuid v1.2.0
	github.com/spf13/cobra v1.0.0
	github.com/spf13/viper v1.7.1
	github.com/storyicon/grbac v0.0.0-20200224041032-a0461737df7e
	github.com/stretchr/testify v1.6.1
	github.com/swaggo/swag v1.7.0
	github.com/tencentyun/cos-go-sdk-v5 v0.7.18
	github.com/upyun/go-sdk/v3 v3.0.2
	gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect
	gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df
	gopkg.in/yaml.v3 v3.0.0-20210107192922-496545a6307b
	gorm.io/driver/mysql v1.0.3
	gorm.io/driver/postgres v1.0.6
	gorm.io/driver/sqlite v1.1.4
	gorm.io/driver/sqlserver v1.0.5
	gorm.io/gorm v1.20.11
)

//replace github.com/saltbo/gopkg => /opt/works/gopkg
