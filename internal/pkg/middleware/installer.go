package middleware

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/spf13/viper"
)

func Installer(c *gin.Context) {
	if !viper.IsSet("installed") {
		ginutil.JSONError(c, 520, fmt.Errorf("system is not initialized"))
		return
	}
}
