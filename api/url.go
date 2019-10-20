package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/satori/go.uuid"

	"zpan/dao"
	"zpan/disk"
	"zpan/model"
	"zpan/pkg/ginx"
)

type URLResource struct {
	provider     disk.Provider
	bucketName   string
	StorageHost  string
	CallbackHost string
}

func NewURLResource(rs *RestServer) Resource {
	return &URLResource{
		provider:     rs.provider,
		bucketName:   rs.conf.Provider.Bucket,
		StorageHost:  rs.conf.StoreHost,
		CallbackHost: rs.conf.SiteHost,
	}
}

func (rs *URLResource) Register(router *ginx.Router) {
	router.GET("/urls/upload", rs.uploadURL)
	router.GET("/urls/download/:id", rs.downloadURL)
	router.GET("/urls/store-host", rs.storeHost)
}

func (rs *URLResource) storeHost(c *gin.Context) error {
	return ginx.Json(c, map[string]string{
		"host": rs.StorageHost,
	})
}

func (rs *URLResource) uploadURL(c *gin.Context) error {
	p := new(QueryMatter)
	if err := c.ShouldBindQuery(p); err != nil {
		return ginx.Error(err)
	}

	uid := c.GetInt64("uid")
	user := new(model.User)
	if _, err := dao.DB.Id(uid).Get(user); err != nil {
		return ginx.Failed(err)
	} else if user.StorageUsed+uint64(p.Size) >= user.StorageMax {
		return ginx.Error(fmt.Errorf("storage not enough space"))
	}

	if !dao.DirExist(uid, p.Dir) {
		return ginx.Error(fmt.Errorf("direction %s not exist.", p.Dir))
	}

	publicRead := false
	if p.Dir == ".pics/" {
		publicRead = true
	}

	object := fmt.Sprintf("%d/%s", uid, uuid.NewV4().String())
	callback := rs.buildCallback(uid, p.Name, p.Type, p.Dir, object)
	url, headers, err := rs.provider.UploadURL(rs.bucketName, p.Name, object, p.Type, callback, publicRead)
	if err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, map[string]interface{}{
		"url":     url,
		"object":  object,
		"headers": headers,
	})
}

func (rs *URLResource) downloadURL(c *gin.Context) error {
	uid := c.GetInt64("uid")
	fileId := c.Param("id")

	file, err := dao.FileGet(uid, fileId)
	if err != nil {
		return ginx.Error(err)
	}

	url, err := rs.provider.DownloadURL(rs.bucketName, file.Object)
	if err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, map[string]string{
		"url": url,
	})
}

func (rs *URLResource) buildCallback(uid int64, filename, fileType, dir, object string) string {
	bodyFormat := `{"uid": %d, "name": "%s", "size": ${size}, "type": "%s","dir": "%s", "object": "%s"}`
	callbackUrl := rs.CallbackHost + "/api/files"
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
