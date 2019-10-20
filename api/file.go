package api

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"zpan/dao"
	"zpan/disk"
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
	provider   disk.Provider
	bucketName string
}

func NewFileResource(rs *RestServer) Resource {
	return &FileResource{
		provider:   rs.provider,
		bucketName: rs.conf.Provider.Bucket,
	}
}

func (f *FileResource) Register(router *ginx.Router) {
	router.POST("/files", f.createFile)
	router.POST("/folders", f.createFolder)

	router.GET("/files", f.findAll)
	router.DELETE("/files/:id", f.delete)
}

func (f *FileResource) findAll(c *gin.Context) error {
	p := new(QueryFiles)
	if err := c.BindQuery(p); err != nil {
		return ginx.Error(err)
	}

	list := make([]model.Matter, 0)
	query := "uid=?"
	params := []interface{}{c.GetInt64("uid")}
	if !p.Search {
		query += " and parent=?"
		params = append(params, p.Dir)
	}
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

func (f *FileResource) createFolder(c *gin.Context) error {
	p := new(BodyFolder)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	uid := c.GetInt64("uid")
	if !dao.DirExist(uid, p.Dir) {
		return ginx.Error(fmt.Errorf("direction %s not exist.", p.Dir))
	}

	m := model.Matter{
		Uid:    uid,
		Dir:    true,
		Name:   p.Name,
		Parent: p.Dir,
		Object: p.Name + "/",
	}
	if _, err := dao.DB.Insert(m); err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, "")
}

func (f *FileResource) createFile(c *gin.Context) error {
	p := new(BodyFile)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Id(p.Uid).Get(user); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("user not exist."))
	}

	exist, err := dao.DB.Where("object=?", p.Object).Exist(&model.Matter{})
	if err != nil {
		return ginx.Failed(err)
	} else if exist {
		return ginx.Error(fmt.Errorf("object %s already exist.", p.Object))
	}

	session := dao.DB.NewSession()
	defer session.Close()

	m := model.Matter{
		Uid:    p.Uid,
		Name:   p.Name,
		Type:   p.Type,
		Size:   p.Size,
		Parent: p.Dir,
		Object: p.Object,
	}
	if _, err := session.Insert(m); err != nil {
		_ = session.Rollback()
		return ginx.Failed(err)
	}

	// update the storage
	user.StorageUsed += uint64(p.Size)
	if _, err := session.ID(p.Uid).Cols("storage_used").Update(user); err != nil {
		_ = session.Rollback()
		return ginx.Error(err)
	}

	if err := session.Commit(); err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, "")
}

func (f *FileResource) delete(c *gin.Context) error {
	uid := c.GetInt64("uid")
	fileId := c.Param("id")

	user := new(model.User)
	if _, err := dao.DB.Id(uid).Get(user); err != nil {
		return ginx.Failed(err)
	}

	file, err := dao.FileGet(uid, fileId)
	if err != nil {
		return ginx.Error(err)
	}

	if err := f.provider.DeleteObject(f.bucketName, file.Object); err != nil {
		return ginx.Failed(err)
	}

	session := dao.DB.NewSession()
	defer session.Close()

	// delete for the list
	if _, err := session.ID(file.Id).Delete(file); err != nil {
		_ = session.Rollback()
		return ginx.Failed(err)
	}

	// update the user storage
	user.StorageUsed -= uint64(file.Size)
	if _, err := session.ID(file.Uid).Cols("storage_used").Update(user); err != nil {
		_ = session.Rollback()
		return ginx.Failed(err)
	}

	if err := session.Commit(); err != nil {
		return ginx.Failed(err)
	}

	return ginx.Ok(c)
}
