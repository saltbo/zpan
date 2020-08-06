package rest

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/dao"
	"github.com/saltbo/zpan/disk"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
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

const (
	DIRTYPE_SYS = iota + 1
	DIRTYPE_USER
)

const (
	OPERATION_COPY = iota + 1
	OPERATION_MOVE
	OPERATION_RENAME
)

type FileResource struct {
	bucketName string
	provider   disk.Provider
}

func NewFileResource(bucketName string, provider disk.Provider) ginutil.Resource {
	return &FileResource{
		bucketName: bucketName,
		provider:   provider,
	}
}

func (f *FileResource) Register(router *gin.RouterGroup) {
	router.GET("/files", f.findAll)
	router.POST("/files/callback", f.fileCallback)
	router.POST("/files/operation", f.fileOperation)
	router.DELETE("/files/:id", f.delete)

	router.GET("/folders", f.findFolders)
	router.POST("/folders", f.createFolder)
}

func (f *FileResource) findAll(c *gin.Context) {
	p := new(bind.QueryFiles)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list := make([]model.Matter, 0)
	query := "uid=? and dirtype!=?"
	params := []interface{}{c.GetInt64("uid"), DIRTYPE_SYS}
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
	total, err := sn.Desc("dirtype").Asc("id").FindAndCount(&list)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (f *FileResource) findFolders(c *gin.Context) {
	p := new(bind.QueryFolder)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	list := make([]model.Matter, 0)
	query := "uid=? and dirtype=? and parent=?"
	sn := dao.DB.Where(query, c.GetInt64("uid"), DIRTYPE_USER, p.Parent)
	total, err := sn.Limit(p.Limit, p.Offset).FindAndCount(&list)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

func (f *FileResource) createFolder(c *gin.Context) {
	p := new(bind.BodyFolder)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := c.GetInt64("uid")
	if !dao.DirExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("direction %s not exist", p.Dir))
		return
	}

	m := model.Matter{
		Uid:     uid,
		Dirtype: DIRTYPE_USER,
		Name:    p.Name,
		Parent:  p.Dir,
	}
	if _, err := dao.DB.Insert(m); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) fileCallback(c *gin.Context) {
	p := new(bind.BodyFile)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	user := new(model.User)
	if exist, err := dao.DB.Id(p.Uid).Get(user); err != nil {
		ginutil.JSONServerError(c, err)
		return
	} else if !exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("user not exist"))
		return
	}

	exist, err := dao.DB.Where("object=?", p.Object).Exist(&model.Matter{})
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	} else if exist {
		ginutil.JSONBadRequest(c, fmt.Errorf("object %s already exist.", p.Object))
		return
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
		ginutil.JSONServerError(c, err)
		return
	}

	// update the storage
	user.StorageUsed += uint64(p.Size)
	if _, err := session.ID(p.Uid).Cols("storage_used").Update(user); err != nil {
		_ = session.Rollback()
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := session.Commit(); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) fileOperation(c *gin.Context) {
	p := new(bind.BodyFileOperation)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := dao.FileGet(c.GetInt64("uid"), p.Id)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	switch p.Action {
	case OPERATION_COPY:
		err = dao.FileCopy(file, p.Dest)
	case OPERATION_MOVE:
		err = dao.FileMove(file.Id, p.Dest)
	case OPERATION_RENAME:
		if file.Dirtype > 0 {
			if err := dao.DirRename(file.Id, p.Dest); err != nil {
				ginutil.JSONServerError(c, err)
				return
			}

			ginutil.JSON(c)
			return
		}

		err = f.provider.TagRename(f.bucketName, file.Object, p.Dest)
		if err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
		err = dao.FileRename(file.Id, p.Dest)
	default:
		err = fmt.Errorf("invalid operation")
	}

	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

func (f *FileResource) delete(c *gin.Context) {
	uid := c.GetInt64("uid")
	fileId := c.Param("id")

	user := new(model.User)
	if _, err := dao.DB.Id(uid).Get(user); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := dao.FileGet(uid, fileId)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := f.provider.DeleteObject(f.bucketName, file.Object); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	session := dao.DB.NewSession()
	defer session.Close()

	// delete for the list
	if _, err := session.ID(file.Id).Delete(file); err != nil {
		_ = session.Rollback()
		ginutil.JSONServerError(c, err)
		return
	}

	// update the user storage
	user.StorageUsed -= uint64(file.Size)
	if _, err := session.ID(file.Uid).Cols("storage_used").Update(user); err != nil {
		_ = session.Rollback()
		ginutil.JSONServerError(c, err)
		return
	}

	if err := session.Commit(); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
