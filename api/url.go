package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/gin-gonic/gin"

	"zpan/cloudengine"
	"zpan/dao"
	"zpan/model"
	"zpan/pkg/ginx"
)

type URLResource struct {
	cloudEngine cloudengine.CE
	bucketName  string
}

func NewURLResource(cloudEngine cloudengine.CE, bucketName string) Resource {
	return &URLResource{
		cloudEngine: cloudEngine,
		bucketName:  bucketName,
	}
}

func (rs *URLResource) Register(router *ginx.Router) {
	router.GET("/urls/:action", rs.signedURL)
}

func (rs *URLResource) signedURL(c *gin.Context) error {
	p := new(QueryMatter)
	if err := c.ShouldBindQuery(p); err != nil {
		return ginx.Error(err)
	}

	uid := c.GetInt64("uid")
	fmt.Println(uid, 11231)
	// valid parent_id
	if exist, err := dao.DB.Where("uid=? and parent_id=?", uid, p.ParentId).Exist(&model.Matter{}); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("parent_id %d not exist.", p.ParentId))
	}

	// valid object
	exist, err := dao.DB.Where("uid=? and parent_id=? and path=?", uid, p.ParentId, p.Object).Exist(&model.Matter{})
	if err != nil {
		return ginx.Failed(err)
	}

	object := fmt.Sprintf("%d/%s", uid, p.Object)
	method := oss.HTTPPut
	action := c.Param("action")
	if action == "download" {
		method = oss.HTTPGet
	}

	if method == oss.HTTPPut && exist {
		return ginx.Error(fmt.Errorf("file %s already exist.", p.Object))
	} else if method == oss.HTTPGet && !exist {
		return ginx.Error(fmt.Errorf("file %s not exist.", p.Object))
	}

	bodyFormat := `{"uid": %d, "path": "%s", "size": ${size}, "type": "%s","parent_id": %d}`
	callbackBody := fmt.Sprintf(bodyFormat, uid, p.Object, p.Type, p.ParentId)
	callbackMap := map[string]string{
		"callbackUrl":      "http://7d7a1a84.cpolar.io/v1/files",
		"callbackBodyType": "application/json",
		"callbackBody":     callbackBody,
	}
	callbackBuffer := bytes.NewBuffer([]byte{})
	callbackEncoder := json.NewEncoder(callbackBuffer)
	callbackEncoder.SetEscapeHTML(false) //do not encode '&' to "\u0026"
	if err := callbackEncoder.Encode(callbackMap); err != nil {
		return ginx.Failed(err)
	}
	callback := base64.StdEncoding.EncodeToString(callbackBuffer.Bytes())
	url, err := rs.cloudEngine.SignURL(rs.bucketName, object, string(method), p.Type, callback)
	if err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, url)
}
