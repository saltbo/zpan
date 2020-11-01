package rest

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/jwtutil"

	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type Storage struct {
	jwtutil.JWTUtil
}

func NewStorageResource() *Storage {
	return &Storage{}
}

func (rs *Storage) Register(router *gin.RouterGroup) {
	router.GET("/storages/:id", rs.find)
	router.GET("/storages", rs.findAll)
	router.POST("/storages", rs.create)
	router.PUT("/storages/:id", rs.update)
	router.DELETE("/storages/:id", rs.delete)
}

func (rs *Storage) find(c *gin.Context) {
	storage, err := service.NewStorage().Find(c.Param("id"))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, storage)

}

func (rs *Storage) findAll(c *gin.Context) {
	p := new(bind.StorageQuery)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := service.NewStorage().FindAll(p.Limit, p.Offset)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs *Storage) create(c *gin.Context) {
	p := new(bind.StorageBody)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	sStorage := service.NewStorage()
	if err := sStorage.Create(p.Model()); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *Storage) update(c *gin.Context) {
	p := new(bind.StorageBody)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	sStorage := service.NewStorage()
	if err := sStorage.Update(c.Param("id"), p.Model()); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *Storage) delete(c *gin.Context) {
	sStorage := service.NewStorage()
	if err := sStorage.Delete(c.Param("id")); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
