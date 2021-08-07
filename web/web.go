package web

import (
	"strings"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
)

func SetupRoutes(ge *gin.Engine) {
	staticRouter := ge.Group("/")
	staticRouter.Use(gzip.Gzip(gzip.DefaultCompression))
	ginutil.SetupEmbedAssets(staticRouter, NewFS(), "/css", "/js", "/fonts")
	ge.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.RequestURI, "/api") {
			return
		}

		c.FileFromFS(c.Request.URL.Path, NewFS())
	})
}
