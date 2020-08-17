package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"

	"github.com/saltbo/zpan/model"
)

type StorageResource struct {
}

func NewStorageResource() *StorageResource {
	return &StorageResource{}
}

func (rs *StorageResource) Register(router *gin.RouterGroup) {
	router.GET("/storage/:uid", rs.find)
}

func (rs *StorageResource) find(c *gin.Context) {
	userId := c.Param("uid")

	storage := new(model.Storage)
	if err := gormutil.DB().First(storage, "user_id=?", userId).Error; err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	ginutil.JSONData(c, storage)
}
