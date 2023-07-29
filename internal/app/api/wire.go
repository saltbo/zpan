package api

import "github.com/google/wire"

type Repository struct {
	file       *FileResource
	recycleBin *RecycleBinResource
	share      *ShareResource
	storage    *StorageResource
	option     *Option
	token      *TokenResource
	user       *UserResource
	userKey    *UserKeyResource
}

func NewRepository(file *FileResource, recycleBin *RecycleBinResource, share *ShareResource, storage *StorageResource, option *Option, token *TokenResource, user *UserResource, userKey *UserKeyResource) *Repository {
	return &Repository{file: file, recycleBin: recycleBin, share: share, storage: storage, option: option, token: token, user: user, userKey: userKey}
}

var ProviderSet = wire.NewSet(
	NewStorageResource,
	NewFileResource,
	NewRecycleBinResource,
	NewOptionResource,
	NewUserResource,
	NewUserKeyResource,
	NewTokenResource,
	NewShareResource,
	NewRepository,
)
