package api

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"zpan/cloudengine"
	"zpan/pkg/ginx"
)

type FileResource struct {
	ce cloudengine.CE
}

func NewFileResource(ce cloudengine.CE) Resource {
	return &FileResource{
		ce: ce,
	}
}

func (rs *FileResource) Register(router *ginx.Router) {
	router.GET("/files/*prefix", rs.findAll)
	router.DELETE("/files/:object", rs.delete)
}

func (rs *FileResource) findAll(c *gin.Context) error {
	prefix := c.Param("prefix")
	marker := c.Query("marker")
	limitStr := c.Query("limit")
	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		limit = 20
	}

	objects, nextMarker, err := rs.ce.ListObject("saltbo", strings.TrimLeft(prefix, "/"), marker, limit)
	if err != nil {
		return ginx.Error(err)
	}

	return ginx.Json(c, map[string]interface{}{
		"objects":     objects,
		"next-marker": nextMarker,
	})
}

func (rs *FileResource) delete(c *gin.Context) error {
	objectKey := c.Param("object")

	err := rs.ce.DeleteObject("saltbo", objectKey)
	if err != nil {
		return ginx.Failed(err)
	}

	return nil
}
