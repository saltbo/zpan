package api

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/assets"
)

func SetupRoutes(ge *gin.Engine) {
	apiRouter := ge.Group("/api")
	ginutil.SetupResource(apiRouter,
		NewOptionResource(),
		NewUserResource(),
		NewTokenResource(),
		NewStorageResource(),
		NewStorageQuotaResource(),
		NewFileResource(),
		NewFolderResource(),
		NewShareResource(),
		NewRecycleBinResource(),
	)

	staticRouter := ge.Group("/")
	ginutil.SetupEmbedAssets(staticRouter, assets.NewFS(), "/css", "/js", "/fonts")
	ge.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.RequestURI, "/api") {
			return
		}

		c.FileFromFS(c.Request.URL.Path, assets.NewFS())
	})
}
