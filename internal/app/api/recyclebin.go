package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/vfs"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type RecycleBinResource struct {
	rbr repo.RecycleBin
	rbf vfs.RecycleBinFs
}

func NewRecycleBinResource(rbr repo.RecycleBin, rbf vfs.RecycleBinFs) *RecycleBinResource {
	return &RecycleBinResource{rbr: rbr, rbf: rbf}
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

	opts := &repo.RecycleBinFindOptions{
		QueryPage: repo.QueryPage(p.QueryPage),
		Uid:       authed.UidGet(c),
		Sid:       p.Sid,
	}
	list, total, err := rs.rbr.FindAll(c, opts)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (rs *RecycleBinResource) recovery(c *gin.Context) {
	alias := c.Param("alias")
	if err := rs.rbf.Recovery(c, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *RecycleBinResource) delete(c *gin.Context) {
	alias := c.Param("alias")
	if err := rs.rbf.Delete(c, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *RecycleBinResource) clean(c *gin.Context) {
	if err := rs.rbf.Clean(c, ginutil.QueryInt64(c, "sid")); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
