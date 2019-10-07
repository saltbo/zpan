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

var docTypes = []string{
	"text/csv",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

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
	router.POST("/files/folders", rs.create)
	router.POST("/files/callback", rs.create)
	router.GET("/files", rs.findAll)
	router.DELETE("/files/:id", rs.delete)
}

func (rs *FileResource) findAll(c *gin.Context) error {
	p := new(QueryFiles)
	if err := c.BindQuery(p); err != nil {
		return ginx.Error(err)
	}

	list := make([]model.Matter, 0)
	query := "uid=? and parent=?"
	params := []interface{}{c.GetInt64("uid"), p.Path}
	if p.Type == "doc" {
		query += " and `type` in ('" + strings.Join(docTypes, "','") + "')"
	} else if p.Type != "" {
		query += " and type like ?"
		params = append(params, p.Type+"%")
	}
	fmt.Println(params)
	sn := dao.DB.Where(query, params...).Limit(p.Limit, p.Offset)
	total, err := sn.Desc("dir").Asc("id").FindAndCount(&list)
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

	if p.Uid == 0 {
		p.Uid = c.GetInt64("uid")
	}

	exist, err := dao.DB.Where("uid=? and parent=? and path=?", p.Uid, p.Parent, p.Path).Exist(&model.Matter{})
	if err != nil {
		return ginx.Failed(err)
	} else if exist {
		return ginx.Error(fmt.Errorf("file %s already exist.", p.Path))
	}

	m := model.Matter{
		Uid:    p.Uid,
		Name:   filepath.Base(p.Path),
		Path:   p.Path,
		Type:   p.Type,
		Size:   p.Size,
		Parent: p.Parent,
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
	id := c.Param("id")
	uid := c.GetInt64("uid")

	m := new(model.Matter)
	exist, err := dao.DB.Id(id).Get(m)
	if err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("file not exist."))
	}

	object := fmt.Sprintf("%d/%s", uid, m.Path)
	if err := rs.cloudEngine.DeleteObject(rs.bucketName, object); err != nil {
		return ginx.Failed(err)
	}

	if _, err := dao.DB.Id(id).Delete(m); err != nil {
		return ginx.Failed(err)
	}

	return ginx.Ok(c)
}
