package rest

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type RecycleBinResource struct {
	rb *service.RecycleBin
}

func NewRecycleBinResource(conf disk.Config) ginutil.Resource {
	provider, err := disk.New(conf)
	if err != nil {
		log.Fatalln(err)
	}

	return &RecycleBinResource{
		rb: service.NewRecycleBin(provider),
	}
}

func (rs *RecycleBinResource) Register(router *gin.RouterGroup) {
	router.GET("/recycles", rs.findAll)
	router.PUT("/recycles/:alias", rs.recovery)
	router.DELETE("/recycles/:alias", rs.delete)
}

func (rs *RecycleBinResource) findAll(c *gin.Context) {
	p := new(bind.QueryPage)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.rb.FindAll(userIdGet(c), p.Offset, p.Limit)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs RecycleBinResource) recovery(c *gin.Context) {
	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.rb.Recovery(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *RecycleBinResource) delete(c *gin.Context) {
	uid := userIdGet(c)
	alias := c.Param("alias")
	if err := rs.rb.Delete(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
