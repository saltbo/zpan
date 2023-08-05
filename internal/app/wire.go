//go:build wireinject
// +build wireinject

package app

import (
	"github.com/google/wire"
	"github.com/saltbo/zpan/internal/app/api"
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase"
)

func InitializeServer() *Server {
	wire.Build(
		dao.NewDBQueryFactory,
		wire.Bind(new(repo.DBQuery), new(*dao.DBQueryFactory)),

		repo.ProviderSet,
		usecase.ProviderSet,
		api.ProviderSet,
		NewServer,
	)
	return &Server{}
}
