package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
)

func SetupRoutes(ge *gin.Engine) {
	apiRouter := ge.Group("/api")
	ginutil.SetupResource(apiRouter,
		NewOptionResource(),
		NewUserResource(),
		NewTokenResource(),
		NewStorageResource(),
		NewFileResource(),
		NewShareResource(),
		NewRecycleBinResource(),
	)
}
