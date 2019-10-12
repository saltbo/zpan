package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"

	"zpan/cloudengine"
	"zpan/dao"
	"zpan/model"
	"zpan/pkg/ginx"
)

type URLResource struct {
	cloudEngine  cloudengine.CE
	bucketName   string
	CallbackHost string
}

func NewURLResource(cloudEngine cloudengine.CE, bucketName, callbackHost string) Resource {
	return &URLResource{
		cloudEngine:  cloudEngine,
		bucketName:   bucketName,
		CallbackHost: callbackHost,
	}
}

func (rs *URLResource) Register(router *ginx.Router) {
	router.GET("/urls/upload", rs.uploadURL)
	router.GET("/urls/download", rs.downloadURL)
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

	if p.Parent != "" {
		// valid parent
		if exist, err := dao.DB.Where("uid=? and path=?", uid, p.Parent).Exist(&model.Matter{}); err != nil {
			return ginx.Failed(err)
		} else if !exist {
			return ginx.Error(fmt.Errorf("parent %s not exist.", p.Parent))
		}
	}

	// valid object
	exist, err := dao.DB.Where("uid=? and parent=? and path=?", uid, p.Parent, p.Object).Exist(&model.Matter{})
	if err != nil {
		return ginx.Failed(err)
	} else if exist {
		return ginx.Error(fmt.Errorf("file %s already exist.", p.Object))
	}

	object := fmt.Sprintf("%d/%s", uid, p.Object)
	bodyFormat := `{"uid": %d, "path": "%s", "size": ${size}, "type": "%s","parent": "%s"}`
	callbackUrl := rs.CallbackHost + "/api/files/callback"
	fmt.Println(callbackUrl)
	callbackBody := fmt.Sprintf(bodyFormat, uid, p.Object, p.Type, p.Parent)
	callbackMap := map[string]string{
		"callbackUrl":      callbackUrl,
		"callbackBodyType": "application/json",
		"callbackBody":     callbackBody,
	}
	callbackBuffer := bytes.NewBuffer([]byte{})
	callbackEncoder := json.NewEncoder(callbackBuffer)
	callbackEncoder.SetEscapeHTML(false) // do not encode '&' to "\u0026"
	if err := callbackEncoder.Encode(callbackMap); err != nil {
		return ginx.Failed(err)
	}
	callback := base64.StdEncoding.EncodeToString(callbackBuffer.Bytes())
	url, err := rs.cloudEngine.UploadURL(rs.bucketName, object, p.Type, callback)
	if err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, map[string]string{
		"url":      url,
		"callback": callback,
	})
}

func (rs *URLResource) downloadURL(c *gin.Context) error {
	p := new(QueryMatter)
	if err := c.ShouldBindQuery(p); err != nil {
		return ginx.Error(err)
	}

	uid := c.GetInt64("uid")
	// valid object
	exist, err := dao.DB.Where("uid=? and parent=? and path=?", uid, p.Parent, p.Object).Exist(&model.Matter{})
	if err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("file %s not exist.", p.Object))
	}

	object := fmt.Sprintf("%d/%s", uid, p.Object)
	url, err := rs.cloudEngine.DownloadURL(rs.bucketName, object)
	if err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, map[string]string{
		"url": url,
	})
}
