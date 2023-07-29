package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/jwtutil"
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/storage"
	"github.com/samber/lo"

	"github.com/saltbo/zpan/internal/pkg/bind"
)

type StorageResource struct {
	jwtutil.JWTUtil

	storageRepo repo.Storage
	storageUc   storage.Storage
}

func NewStorageResource(storageRepo repo.Storage, storageUc storage.Storage) *StorageResource {
	return &StorageResource{storageRepo: storageRepo, storageUc: storageUc}
}

func (rs *StorageResource) Register(router *gin.RouterGroup) {
	router.GET("/storages/:id", rs.find)
	router.GET("/storages", rs.findAll)
	router.POST("/storages", rs.create)
	router.PUT("/storages/:id", rs.update)
	router.DELETE("/storages/:id", rs.delete)
}

func (rs *StorageResource) find(c *gin.Context) {
	ret, err := rs.storageRepo.Find(c, ginutil.ParamInt64(c, "id"))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, ret)

}

func (rs *StorageResource) findAll(c *gin.Context) {
	p := new(bind.StorageQuery)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.storageRepo.FindAll(c, &repo.StorageFindOptions{Limit: p.Limit, Offset: p.Offset})
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	lo.Map(list, func(item *entity.Storage, index int) *entity.Storage {
		item.SecretKey = item.SKAsterisk()
		return item
	})

	ginutil.JSONList(c, list, total)
}

func (rs *StorageResource) create(c *gin.Context) {
	p := new(bind.StorageBody)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.storageUc.Create(c, p.Model()); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *StorageResource) update(c *gin.Context) {
	p := new(bind.StorageBody)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.storageRepo.Update(c, ginutil.ParamInt64(c, "id"), p.Model()); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *StorageResource) delete(c *gin.Context) {
	if err := rs.storageRepo.Delete(c, ginutil.ParamInt64(c, "id")); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
