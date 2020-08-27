package rest

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/timeutil"
	moreu "github.com/saltbo/moreu/client"
	uuid "github.com/satori/go.uuid"

	"github.com/saltbo/zpan/config"
	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/rest/bind"
	"github.com/saltbo/zpan/service"
)

type LinkResource struct {
	provider   disk.Provider
	bucketName string

	storageHost  string
	callbackHost string
}

func NewURLResource(conf *config.Config, provider disk.Provider) ginutil.Resource {
	return &LinkResource{
		provider:     provider,
		bucketName:   conf.Provider.Bucket,
		storageHost:  conf.StoreHost,
		callbackHost: conf.SiteHost,
	}
}

func (rs *LinkResource) Register(router *gin.RouterGroup) {
	router.POST("/links/upload", rs.createUploadURL)
	router.POST("/links/download", rs.createDownloadURL)
}

func (rs *LinkResource) createUploadURL(c *gin.Context) {
	p := new(bind.BodyUploadLink)
	if err := c.ShouldBind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	} else if p.Type == "" {
		p.Type = "application/octet-stream"
	}

	uid := moreu.GetUserId(c)
	if err := service.StorageQuotaVerify(uid, p.Size); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if !service.MatterParentExist(uid, p.Dir) {
		ginutil.JSONBadRequest(c, fmt.Errorf("parent dir not exist"))
		return
	}

	//	auto append a suffix if matter exist
	if service.MatterExist(uid, p.Name, p.Dir) {
		ext := filepath.Ext(p.Name)
		name := strings.TrimSuffix(p.Name, ext)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		p.Name = name + suffix + ext
	}

	publicRead := false
	if p.Dir == ".pics/" {
		publicRead = true
	}

	object := fmt.Sprintf("%d/%s", uid, uuid.NewV4().String())
	callbackUrl := rs.callbackHost + "/api/files"
	bodyFormat := `{"uid": %d, "name": "%s", "size": ${size}, "type": "%s","dir": "%s", "object": "%s"}`
	callbackBody := fmt.Sprintf(bodyFormat, uid, p.Name, p.Type, p.Dir, object)
	callback := rs.provider.BuildCallback(callbackUrl, callbackBody)
	link, headers, err := rs.provider.UploadURL(rs.bucketName, p.Name, object, p.Type, callback, publicRead)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"link":    link,
		"object":  object,
		"headers": headers,
	})
}

func (rs *LinkResource) createDownloadURL(c *gin.Context) {
	p := new(bind.BodyDownloadLink)
	if err := c.ShouldBind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	file, err := service.FileGet(p.Alias)
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	link, err := rs.provider.DownloadURL(rs.bucketName, file.Object)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, gin.H{
		"link": link,
	})
}
