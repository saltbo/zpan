package ginutil

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// SetupEmbedAssets registers handlers to serve embedded assets from an http.FileSystem.
func SetupEmbedAssets(rg *gin.RouterGroup, fs http.FileSystem, relativePaths ...string) {
	handler := func(c *gin.Context) {
		c.FileFromFS(strings.TrimPrefix(c.Request.URL.Path, rg.BasePath()), fs)
	}

	for _, relativePath := range relativePaths {
		urlPattern := relativePath
		if urlPattern != "/" {
			urlPattern = path.Join(relativePath, "/*filepath")
		}
		rg.GET(urlPattern, handler)
		rg.HEAD(urlPattern, handler)
	}
}

// SetupStaticAssets registers handlers for a directory tree on disk.
func SetupStaticAssets(rg *gin.RouterGroup, dir string) {
	_, rootDirName := filepath.Split(dir)
	staticLoader := func(p string, info os.FileInfo, err error) error {
		if info == nil {
			return err
		}

		if info.IsDir() && info.Name() != rootDirName {
			rg.Static(info.Name(), p)
			return nil
		}

		if info.Name() == "index.html" {
			rg.StaticFile("/", p)
		}

		return nil
	}

	if err := filepath.Walk(dir, staticLoader); err != nil {
		log.Fatalln(err)
	}
}
