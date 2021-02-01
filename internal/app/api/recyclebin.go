package api

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
	"github.com/saltbo/zpan/internal/app/service"
)

type RecycleBinResource struct {
	rb *service.RecycleBin
}

func NewRecycleBinResource() ginutil.Resource {
	return &RecycleBinResource{
		rb: service.NewRecycleBin(),
	}
}

func (rs *RecycleBinResource) Register(router *gin.RouterGroup) {
	router.GET("/recycles", rs.findAll)
	router.PUT("/recycles/:alias", rs.recovery)
	router.DELETE("/recycles/:alias", rs.delete)
	router.DELETE("/recycles", rs.clean)
}

func (rs *RecycleBinResource) findAll(c *gin.Context) {
	p := new(bind.QueryRecycle)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.rb.FindAll(authed.UidGet(c), p.Sid, p.Offset, p.Limit)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs RecycleBinResource) recovery(c *gin.Context) {
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.rb.Recovery(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *RecycleBinResource) delete(c *gin.Context) {
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.rb.Delete(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *RecycleBinResource) clean(c *gin.Context) {
	uid := authed.UidGet(c)
	sid, _ := strconv.ParseInt(c.Query("sid"), 10, 64)
	if err := rs.rb.Clean(uid, sid); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
