package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/usecase/authz"
	_ "github.com/saltbo/zpan/internal/docs"
)

// @title zpan
// @description zpan apis
// @version 1.0.0

// @BasePath /api/
// @securitydefinitions.oauth2.application OAuth2Application
// @scope.matter Grants matter access and write
// @scope.admin Grants read and write access to administrative information
// @tokenUrl /api/tokens
// @name Authorization

// @contact.name API Support
// @contact.url http://zpan.space
// @contact.email saltbo@foxmail.com

// @license.name GPL 3.0
// @license.url https://github.com/saltbo/zpan/blob/master/LICENSE

func SetupRoutes(ge *gin.Engine, repository *Repository) {
	ginutil.SetupSwagger(ge)

	apiRouter := ge.Group("/api")
	apiRouter.Use(authz.NewMiddleware)
	ginutil.SetupResource(apiRouter,
		repository.option,
		repository.file,
		repository.storage,
		repository.share,
		repository.token,
		repository.user,
		repository.userKey,
		repository.recycleBin,
	)
}
