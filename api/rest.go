package api

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rakyll/statik/fs"

	_ "zpan/assets"
	"zpan/cloudengine"
	"zpan/pkg/ginx"
)

type Resource interface {
	Register(router *ginx.Router)
}

type RestServer struct {
	srv       *http.Server
	router    *gin.Engine
	resources []Resource
	staticRs  http.FileSystem
}

func NewRest(ce cloudengine.CE, bucketName string) (*RestServer, error) {
	resources := []Resource{
		NewUserResource(),
		NewURLResource(ce, bucketName),
		NewFileResource(ce, bucketName),
	}

	staticRs, err := fs.New()
	if err != nil {
		return nil, err
	}

	router := gin.Default()
	srv := &http.Server{
		Addr:    ":8081",
		Handler: router,
	}

	return &RestServer{
		srv:       srv,
		router:    router,
		resources: resources,
		staticRs:  staticRs,
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
}

func (rs *RestServer) setupResource() {
	rs.router.GET("/", rs.staticFS)
	rs.router.GET("/js/*filepath", rs.staticFS)
	rs.router.GET("/css/*filepath", rs.staticFS)
	rs.router.GET("/fonts/*filepath", rs.staticFS)
	rs.router.NoRoute(func(c *gin.Context) {
		indexHtml, err := rs.staticRs.Open("/index.html")
		if err != nil {
			_ = c.AbortWithError(http.StatusInternalServerError, err)
			return
		}

		fsInfo, _ := indexHtml.Stat()
		contentType := "text/html"
		extraHeaders := map[string]string{}
		c.DataFromReader(http.StatusOK, fsInfo.Size(), contentType, indexHtml, extraHeaders)
	})

	resourceRouter := rs.router.Group("/api")
	// resourceRouter.Use(LoggerHandler())
	for _, resource := range rs.resources {
		resource.Register(ginx.NewRouter(resourceRouter))
	}
}

func (rs *RestServer) staticFS(c *gin.Context) {
	fileServer := http.FileServer(rs.staticRs)
	fileServer.ServeHTTP(c.Writer, c.Request)
}
