package main

import (
	"github.com/saltbo/zpan/internal/app/entity"
	"gorm.io/gen"
)

func main() {
	g := gen.NewGenerator(gen.Config{
		OutPath: "./internal/app/repo/query",
		Mode:    gen.WithoutContext | gen.WithDefaultQuery | gen.WithQueryInterface, // generate mode
	})

	// Generate basic type-safe DAO API for struct `model.User` following conventions
	g.ApplyBasic(entity.Storage{}, entity.Matter{}, entity.RecycleBin{}, entity.UserStorage{})

	// Generate the code
	g.Execute()
}
