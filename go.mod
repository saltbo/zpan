module github.com/saltbo/zpan

go 1.14

require (
	github.com/aliyun/aliyun-oss-go-sdk v2.1.4+incompatible
	github.com/gin-gonic/gin v1.6.3
	github.com/jinzhu/gorm v1.9.16
	github.com/mitchellh/go-homedir v1.1.0
	github.com/rakyll/statik v0.1.7
	github.com/saltbo/gopkg v0.0.0-20200822175914-b423d3d057ad
	github.com/saltbo/moreu v0.0.0-20200818144911-48e1687bed0a
	github.com/satori/go.uuid v1.2.0
	github.com/spf13/cobra v1.0.0
	github.com/spf13/viper v1.7.1
)

//replace github.com/saltbo/gopkg => /opt/works/gopkg
