package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
	"github.com/saltbo/zpan/internal/pkg/fakefs"
)

type FileResource struct {
	fs *fakefs.FakeFS
}

func NewFileResource() ginutil.Resource {
	return &FileResource{
		fs: fakefs.New(),
	}
}

func (rs *FileResource) Register(router *gin.RouterGroup) {
	router.POST("/matters", rs.create)
	router.GET("/matters", rs.findAll)
	router.GET("/matters/:alias", rs.find)
	router.GET("/matters/:alias/ulink", rs.ulink)
	router.PATCH("/matters/:alias/done", rs.uploaded)
	router.PATCH("/matters/:alias/done/multipart", rs.uploadedMultipart)
	router.PATCH("/matters/:alias/name", rs.rename)
	router.PATCH("/matters/:alias/location", rs.move)
	router.PATCH("/matters/:alias/duplicate", rs.copy)
	router.PATCH("/matters/:alias/part", rs.uploadPart)
	router.DELETE("/matters/:alias", rs.delete)
	rs.fs.StartFileAutoDoneWorker()
}

func (rs *FileResource) findAll(c *gin.Context) {
	p := new(bind.QueryFiles)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list, total, err := rs.fs.List(authed.UidGet(c), p)
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
// @Success 200 {object} httputil.JSONResponse{data=model.User}
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
	op := rs.fs.CreateFolder
	if !m.IsDir() {
		if rs.fs.TouchSupport(m) && m.Size > 10000000 {
			op = rs.fs.TouchFile
		} else {
			op = rs.fs.CreateFile
		}
	}

	data, err := op(m)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, data)
}

func (rs *FileResource) uploadPart(c *gin.Context) {
	p := new(bind.BodyMatterMultipart)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	m, err := rs.fs.CreateFilePart(uid, alias, p)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, m)
}

func (rs *FileResource) uploadedMultipart(c *gin.Context) {
	p := new(bind.BodyMatterMultipart)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	m, err := rs.fs.FinishFilePart(uid, alias, p)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, m)
}

func (rs *FileResource) uploaded(c *gin.Context) {
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	m, err := rs.fs.TagUploadDone(uid, alias)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}
	ginutil.JSONData(c, m)
}

func (rs *FileResource) find(c *gin.Context) {
	matter, err := rs.fs.GetFileInfo(authed.UidGet(c), c.Param("alias"))
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

	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Rename(uid, alias, p.NewName); err != nil {
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

	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Move(uid, alias, p.NewDir); err != nil {
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

	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Copy(uid, alias, p.NewPath); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) delete(c *gin.Context) {
	uid := authed.UidGet(c)
	alias := c.Param("alias")
	if err := rs.fs.Delete(uid, alias); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (rs *FileResource) ulink(c *gin.Context) {
	data, err := rs.fs.GetSaveRequest(authed.UidGet(c), c.Param("alias"))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, data)
}
