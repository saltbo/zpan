package usecase

import (
	"github.com/google/wire"
	"github.com/saltbo/zpan/internal/app/usecase/storage"
	"github.com/saltbo/zpan/internal/app/usecase/uploader"
	"github.com/saltbo/zpan/internal/app/usecase/vfs"
)

type Repository struct {
	Storage  storage.Storage
	Uploader uploader.Uploader
	VFS      vfs.VirtualFs
}

func NewRepository(storage storage.Storage, uploader uploader.Uploader, VFS vfs.VirtualFs) *Repository {
	return &Repository{Storage: storage, Uploader: uploader, VFS: VFS}
}

var ProviderSet = wire.NewSet(
	storage.NewCloudStorage,
	uploader.NewCloudUploader,
	vfs.NewVfs,
	vfs.NewRecycleBin,

	wire.Bind(new(storage.Storage), new(*storage.CloudStorage)),
	wire.Bind(new(uploader.Uploader), new(*uploader.CloudUploader)),
	wire.Bind(new(vfs.VirtualFs), new(*vfs.Vfs)),
	wire.Bind(new(vfs.RecycleBinFs), new(*vfs.RecycleBin)),
	NewRepository,
)
