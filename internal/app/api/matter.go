package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/uploader"
	"github.com/saltbo/zpan/internal/app/usecase/vfs"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type FileResource struct {
	fs vfs.VirtualFs
	up uploader.Uploader
}

func NewFileResource(fs vfs.VirtualFs, up uploader.Uploader) *FileResource {
	return &FileResource{fs: fs, up: up}
}

func (rs *FileResource) Register(router *gin.RouterGroup) {
	router.POST("/matters", rs.create)
	router.GET("/matters", rs.findAll)
	router.GET("/matters/:alias", rs.find)
	router.GET("/matters/:alias/ulink", rs.ulink)
	router.PATCH("/matters/:alias/done", rs.uploaded)
	router.PATCH("/matters/:alias/name", rs.rename)
	router.PATCH("/matters/:alias/location", rs.move)
	router.PATCH("/matters/:alias/duplicate", rs.copy)
	router.DELETE("/matters/:alias", rs.delete)
	// rs.fs.StartFileAutoDoneWorker()
}

func (rs *FileResource) findAll(c *gin.Context) {
	p := new(repo.MatterListOption)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.fs.List(c, p)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

// create godoc
// @Tags Matters
// @Summary 创建文件
// @Description 创建文件
// @Accept json
// @Produce json
// @Security OAuth2Application[matter, admin]
// @Param body body bind.BodyMatter true "参数"
// @Success 200 {object} httputil.JSONResponse{data=entity.Matter}
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /matters [post]
func (rs *FileResource) create(c *gin.Context) {
	p := new(bind.BodyMatter)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	m := p.ToMatter(authed.UidGet(c))
	if err := rs.fs.Create(c, m); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"matter":  m,
		"uplink":  m.Uploader["upURL"],
		"headers": m.Uploader["upHeaders"],
	})
}

func (rs *FileResource) uploaded(c *gin.Context) {
	alias := c.Param("alias")
	m, err := rs.fs.Get(c, alias)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.up.UploadDone(c, m); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, m)
}

func (rs *FileResource) find(c *gin.Context) {
	matter, err := rs.fs.Get(c, c.Param("alias"))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, matter)
}

func (rs *FileResource) rename(c *gin.Context) {
	p := new(bind.BodyFileRename)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.fs.Rename(c, c.Param("alias"), p.NewName); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) move(c *gin.Context) {
	p := new(bind.BodyFileMove)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.fs.Move(c, c.Param("alias"), p.NewDir); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) copy(c *gin.Context) {
	p := new(bind.BodyFileCopy)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	m, err := rs.fs.Copy(c, c.Param("alias"), p.NewPath)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, m)
}

func (rs *FileResource) delete(c *gin.Context) {
	if err := rs.fs.Delete(c, c.Param("alias")); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) ulink(c *gin.Context) {
	// data, err := rs.up.GetPreSign(authed.UidGet(c), c.Param("alias"))
	// if err != nil {
	// 	ginutil.JSONServerError(c, err)
	// 	return
	// }
	//
	// ginutil.JSONData(c, data)
}
