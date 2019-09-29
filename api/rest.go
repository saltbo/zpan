package api

import (
	"context"
	"github.com/gin-gonic/gin"
	"log"
	"net/http"
	"time"

	"zpan/cloudengine"
	"zpan/pkg/ginx"
	"zpan/version"
)

type Resource interface {
	Register(router *ginx.Router)
}

///
type RestServer struct {
	srv       *http.Server
	router    *gin.Engine
	resources []Resource
}

func NewRest(ce cloudengine.CE, bucketName string) (*RestServer, error) {
	resources := []Resource{
		NewUserResource(),
		NewURLResource(ce, bucketName),
		NewFileResource(ce, bucketName),
	}

	router := gin.New()
	srv := &http.Server{
		Addr:    ":8001",
		Handler: router,
	}

	return &RestServer{
		srv:       srv,
		router:    router,
		resources: resources,
	}, nil
}

func (rs *RestServer) Run() error {
	rs.setupPing()
	rs.setupResource()

	log.Printf("[rest server started, listen %s]", rs.srv.Addr)
	if err := rs.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("[rest server listen failed: %v]", err)
	}

	return nil
}

func (rs *RestServer) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rs.srv.Shutdown(ctx); err != nil {
		log.Fatal("[rest server shutdown err:]", err)
	}

	log.Printf("[rest server exited.]")
}

func (rs *RestServer) setupPing() {
	pingHandler := func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	}

	rs.router.HEAD("/ping", pingHandler)
	rs.router.GET("/ping", pingHandler)
	rs.router.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, "Service version - "+version.Long)
	})
}

func (rs *RestServer) setupResource() {
	resourceRouter := rs.router.Group("/v1")
	//resourceRouter.Use(LoggerHandler())
	for _, resource := range rs.resources {
		resource.Register(ginx.NewRouter(resourceRouter))
	}
}
