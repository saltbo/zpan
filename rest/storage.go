package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	moreu "github.com/saltbo/moreu/client"

	"github.com/saltbo/zpan/model"
)

const defaultSize = 50 << 20

type StorageResource struct {
	defaultSize uint64
}

func NewStorageResource(initSize uint64) *StorageResource {
	if initSize == 0 {
		initSize = defaultSize
	}

	return &StorageResource{
		defaultSize: initSize,
	}
}

func (rs *StorageResource) Register(router *gin.RouterGroup) {
	router.GET("/storage", rs.find)
}

func (rs *StorageResource) find(c *gin.Context) {
	storage := &model.Storage{
		UserId: moreu.GetUserId(c),
		Max:    rs.defaultSize,
	}
	if err := gormutil.DB().FirstOrCreate(storage, "user_id=?", storage.UserId).Error; err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, storage)
}
