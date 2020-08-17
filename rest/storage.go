package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	moreu "github.com/saltbo/moreu/client"

	"github.com/saltbo/zpan/model"
)

const defaultSize = uint64(50 * 1024 * 1024)

type StorageResource struct {
}

func NewStorageResource() *StorageResource {
	return &StorageResource{}
}

func (rs *StorageResource) Register(router *gin.RouterGroup) {
	router.GET("/storage", rs.find)
}

func (rs *StorageResource) find(c *gin.Context) {
	storage := &model.Storage{
		UserId: moreu.GetUserId(c),
		Max:    defaultSize,
	}
	if err := gormutil.DB().FirstOrCreate(storage, "user_id=?", storage.UserId).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, storage)
}
