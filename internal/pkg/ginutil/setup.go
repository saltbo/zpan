package ginutil

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/httputil"
)

type Resource interface {
	Register(router *gin.RouterGroup)
}

// SetupResource registers REST resources under a router group.
func SetupResource(rg *gin.RouterGroup, resources ...Resource) {
	for _, resource := range resources {
		resource.Register(rg)
	}
}

// SetupPing registers a simple health endpoint.
func SetupPing(e *gin.Engine) {
	pingHandler := func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	}

	e.HEAD("/ping", pingHandler)
	e.GET("/ping", pingHandler)
}

// Startup runs the server and installs graceful shutdown.
func Startup(e *gin.Engine, addr string) {
	srv := &http.Server{
		Addr:    addr,
		Handler: e,
	}

	go func() {
		log.Printf("[rest server listen at %s]", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalln(err)
		}
	}()

	httputil.SetupGracefulStop(srv)
}
