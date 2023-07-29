package repo

import "github.com/google/wire"

type Repository struct {
	Storage    Storage
	Matter     Matter
	RecycleBin RecycleBin
}

func NewRepository(storage Storage, matter Matter, recycleBin RecycleBin) *Repository {
	return &Repository{Storage: storage, Matter: matter, RecycleBin: recycleBin}
}

var ProviderSet = wire.NewSet(
	NewStorageDBQuery,
	NewMatterDBQuery,
	NewRecycleBinDBQuery,

	wire.Bind(new(Storage), new(*StorageDBQuery)),
	wire.Bind(new(Matter), new(*MatterDBQuery)),
	wire.Bind(new(RecycleBin), new(*RecycleBinDBQuery)),
	NewRepository,
)
