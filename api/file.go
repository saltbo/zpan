package api

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"zpan/cloudengine"
	"zpan/dao"
	"zpan/model"
	"zpan/pkg/ginx"
)

type FileResource struct {
	cloudEngine cloudengine.CE
	bucketName  string
}

func NewFileResource(cloudEngine cloudengine.CE, bucketName string) Resource {
	return &FileResource{
		cloudEngine: cloudEngine,
		bucketName:  bucketName,
	}
}

func (rs *FileResource) Register(router *ginx.Router) {
	router.POST("/files", rs.create)
	router.GET("/files", rs.findAll)
	router.DELETE("/files/:object", rs.delete)
}

func (rs *FileResource) findAll(c *gin.Context) error {
	p := new(QueryFiles)
	if err := c.BindQuery(p); err != nil {
		return ginx.Error(err)
	}

	list := make([]model.Matter, 0)
	query := dao.DB.Where("parent_id=?", p.ParentId).Limit(p.Limit, p.Offset)
	total, err := query.Desc("dir").Asc("id").FindAndCount(&list)
	if err != nil {
		return ginx.Error(err)
	}

	return ginx.JsonList(c, list, total)
}

func (rs *FileResource) create(c *gin.Context) error {
	p := new(BodyMatter)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	exist, err := dao.DB.Where("uid=? and parent_id=? and path=?", p.Uid, p.ParentId, p.Path).Exist(&model.Matter{})
	if err != nil {
		return ginx.Failed(err)
	} else if exist {
		return ginx.Error(fmt.Errorf("file %s already exist.", p.Path))
	}

	m := model.Matter{
		Uid:      p.Uid,
		Name:     filepath.Base(p.Path),
		Path:     p.Path,
		Type:     p.Type,
		Size:     p.Size,
		ParentId: p.ParentId,
	}
	if m.Size == 0 && strings.HasSuffix(m.Path, "/") {
		m.Dir = true
	}
	if _, err := dao.DB.Insert(m); err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, "")
}

func (rs *FileResource) delete(c *gin.Context) error {
	objectKey := c.Param("object")

	err := rs.cloudEngine.DeleteObject(rs.bucketName, objectKey)
	if err != nil {
		return ginx.Failed(err)
	}

	return nil
}
