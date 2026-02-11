package app

import (
	"fmt"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/api"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase"
	"github.com/saltbo/zpan/internal/pkg/logger"
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
	// 根据日志级别设置 Gin 模式
	if logger.GetLogLevel() <= slog.LevelDebug {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	ge := gin.New()
	
	// 添加自定义 slog 日志中间件
	ge.Use(logger.GinSlogMiddleware())
	
	// 添加恢复中间件
	ge.Use(gin.Recovery())
	
	api.SetupRoutes(ge, s.ap)
	web.SetupRoutes(ge)
	ginutil.Startup(ge, fmt.Sprintf(":%d", viper.GetInt("port")))
	return nil
}
