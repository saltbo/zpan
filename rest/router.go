package rest

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/assets"
	"github.com/saltbo/zpan/dao"
)

func SetupRoutes(ge *gin.Engine) {
	apiRouter := ge.Group("/api")
	apiRouter.Use(authentication())
	ginutil.SetupResource(apiRouter,
		NewOptionResource(),
		NewUserResource(),
		NewStorageResource(),
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

func authentication() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := dao.NewUser().FindByUx(c.GetHeader("X-Zplat-Ux"))
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}

		c.Set("uid", user.Id)
	}
}

func userIdGet(c *gin.Context) int64 {
	return c.GetInt64("uid")
}
