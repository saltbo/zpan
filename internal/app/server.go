//go:build wireinject
// +build wireinject

package app

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/google/wire"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/api"
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase"
	"github.com/saltbo/zpan/web"
	"github.com/spf13/viper"
)

type Server struct {
	uc *usecase.Repository
	rp *repo.Repository
	ap *api.Repository
}

func newServer(rp *repo.Repository, uc *usecase.Repository, ap *api.Repository) *Server {
	return &Server{rp: rp, uc: uc, ap: ap}
}

func NewServer() *Server {
	wire.Build(dao.GetDBQuery, repo.ProviderSet, usecase.ProviderSet, api.ProviderSet, newServer)
	return &Server{}
}

func (s *Server) Run() error {
	// gin.SetMode(gin.ReleaseMode)
	ge := gin.Default()
	api.SetupRoutes(ge, s.ap)
	web.SetupRoutes(ge)
	ginutil.Startup(ge, fmt.Sprintf(":%d", viper.GetInt("port")))
	return nil
}
