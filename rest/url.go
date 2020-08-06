package rest

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	uuid "github.com/satori/go.uuid"

	"github.com/saltbo/zpan/config"
	"github.com/saltbo/zpan/dao"
	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest/bind"
)

type URLResource struct {
	provider     disk.Provider
	bucketName   string
	StorageHost  string
	CallbackHost string
}

func NewURLResource(conf *config.Config, provider disk.Provider) ginutil.Resource {
	return &URLResource{
		provider:     provider,
		bucketName:   conf.Provider.Bucket,
		StorageHost:  conf.StoreHost,
		CallbackHost: conf.SiteHost,
	}
}

func (rs *URLResource) Register(router *gin.RouterGroup) {
	router.GET("/urls/store-host", rs.storeHost)
	router.GET("/urls/upload", rs.uploadURL)
	router.GET("/urls/download/:id", rs.downloadURL)
}

func (rs *URLResource) storeHost(c *gin.Context) {
	ginutil.JSONData(c, gin.H{
		"host": rs.StorageHost,
	})
}

func (rs *URLResource) uploadURL(c *gin.Context) {
	p := new(bind.QueryMatter)
	if err := c.ShouldBindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := c.GetInt64("uid")
	user := new(model.User)
	if _, err := dao.DB.Id(uid).Get(user); err != nil {
		ginutil.JSONServerError(c, err)
		return
	} else if user.StorageUsed+uint64(p.Size) >= user.StorageMax {
		ginutil.JSONBadRequest(c, fmt.Errorf("storage not enough space"))
	}

	if !dao.DirExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("direction %s not exist.", p.Dir))
	}

	publicRead := false
	if p.Dir == ".pics/" {
		publicRead = true
	}

	if p.Type == "" {
		p.Type = "application/octet-stream"
	}

	object := fmt.Sprintf("%d/%s", uid, uuid.NewV4().String())
	callback := rs.buildCallback(uid, p.Name, p.Type, p.Dir, object)
	url, headers, err := rs.provider.UploadURL(rs.bucketName, p.Name, object, p.Type, callback, publicRead)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"url":     url,
		"object":  object,
		"headers": headers,
	})
}

func (rs *URLResource) downloadURL(c *gin.Context) {
	uid := c.GetInt64("uid")
	fileId := c.Param("id")

	file, err := dao.FileGet(uid, fileId)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	url, err := rs.provider.DownloadURL(rs.bucketName, file.Object)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"url": url,
	})
}

func (rs *URLResource) buildCallback(uid int64, filename, fileType, dir, object string) string {
	bodyFormat := `{"uid": %d, "name": "%s", "size": ${size}, "type": "%s","dir": "%s", "object": "%s"}`
	callbackUrl := rs.CallbackHost + "/api/files/callback"
	callbackBody := fmt.Sprintf(bodyFormat, uid, filename, fileType, dir, object)
	callbackMap := map[string]string{
		"callbackUrl":      callbackUrl,
		"callbackBodyType": "application/json",
		"callbackBody":     callbackBody,
	}
	callbackBuffer := bytes.NewBuffer([]byte{})
	callbackEncoder := json.NewEncoder(callbackBuffer)
	callbackEncoder.SetEscapeHTML(false) // do not encode '&' to "\u0026"
	if err := callbackEncoder.Encode(callbackMap); err != nil {
		log.Panic(err)
	}

	return base64.StdEncoding.EncodeToString(callbackBuffer.Bytes())
}
