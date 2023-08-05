package app

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/api"
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

func NewServer(uc *usecase.Repository, rp *repo.Repository, ap *api.Repository) *Server {
	return &Server{uc: uc, rp: rp, ap: ap}
}

func (s *Server) Run() error {
	// gin.SetMode(gin.ReleaseMode)
	ge := gin.Default()
	api.SetupRoutes(ge, s.ap)
	web.SetupRoutes(ge)
	ginutil.Startup(ge, fmt.Sprintf(":%d", viper.GetInt("port")))
	return nil
}
