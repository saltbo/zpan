package ginx

import (
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
)

type HandlerFunc func(c *gin.Context) error

type Router struct {
	rg *gin.RouterGroup
}

func NewRouter(rg *gin.RouterGroup) *Router {
	return &Router{rg: rg}
}

func (r *Router) wrapper(handler HandlerFunc) func(c *gin.Context) {
	return func(c *gin.Context) {
		err := handler(c)
		if err == nil {
			return
		}

		var ret *Result
		if errors.As(err, &ret) {
			c.AbortWithStatusJSON(ret.Code, ret)
			return
		}

		_ = c.AbortWithError(http.StatusNotImplemented, err)
	}
}

func (r *Router) Use(middlewares ...HandlerFunc) {
	for _, middleware := range middlewares {
		r.rg.Use(r.wrapper(middleware))
	}
}

func (r *Router) GET(relativePath string, handler HandlerFunc) {
	r.rg.GET(relativePath, r.wrapper(handler))
}

func (r *Router) POST(relativePath string, handler HandlerFunc) {
	r.rg.POST(relativePath, r.wrapper(handler))
}

func (r *Router) DELETE(relativePath string, handler HandlerFunc) {
	r.rg.DELETE(relativePath, r.wrapper(handler))
}

func (r *Router) PATCH(relativePath string, handler HandlerFunc) {
	r.rg.PATCH(relativePath, r.wrapper(handler))
}

func (r *Router) PUT(relativePath string, handler HandlerFunc) {
	r.rg.PUT(relativePath, r.wrapper(handler))
}
