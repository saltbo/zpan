package api

import (
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/gin-gonic/gin"

	"zpan/cloudengine"
	"zpan/pkg/ginx"
)

type URLResource struct {
	ce cloudengine.CE
}

func NewURLResource(ce cloudengine.CE) Resource {
	return &URLResource{
		ce: ce,
	}
}

func (rs *URLResource) Register(router *ginx.Router) {
	router.GET("/urls/:action", rs.signedURL)
}

func (rs *URLResource) signedURL(c *gin.Context) error {
	p := new(QSignURL)
	if err := c.ShouldBindQuery(p); err != nil {
		return ginx.Error(err)
	}

	method := oss.HTTPPut
	action := c.Param("action")
	if action == "download" {
		method = oss.HTTPGet
	}

	url, err := rs.ce.SignURL("saltbo", p.ObjectKey, string(method), p.ContentType)
	if err != nil {
		return ginx.Failed(err)
	}

	return ginx.Json(c, url)
}
