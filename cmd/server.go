/*
Copyright © 2020 Ambor <saltbo@foxmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
package cmd

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/gopkg/httputil"
	"github.com/spf13/cobra"
	"golang.org/x/crypto/acme/autocert"

	"github.com/saltbo/zpan/assets"
	"github.com/saltbo/zpan/config"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest"
)

// serverCmd represents the server command
var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "A cloud disk base on the cloud service.",
	Run: func(cmd *cobra.Command, args []string) {
		c := config.Parse()
		serverRun(c)
	},
}

func init() {
	rootCmd.AddCommand(serverCmd)
}

func serverRun(conf *config.Config) {
	if !conf.Debug {
		gin.SetMode(gin.ReleaseMode)
	}

	gormutil.Init(conf.Database, conf.Debug)
	gormutil.AutoMigrate(model.Tables())

	ge := gin.Default()
	if conf.EmailAct() {
	}

	//ge.Use(mu.Auth(rest.Roles()))

	userResource := rest.NewUserResource(conf.Storage)
	apiRouter := ge.Group("/api")
	apiRouter.Use(userResource.Injector())
	ginutil.SetupResource(apiRouter, userResource,
		rest.NewStorageResource(),
		rest.NewFileResource(),
		rest.NewFolderResource(),
		rest.NewShareResource(),
		rest.NewRecycleBinResource(),
	)

	ginutil.SetupEmbedAssets(ge.Group("/"),
		assets.EmbedFS(), "/css", "/js", "/fonts")
	ge.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.RequestURI, "/api") {
			return
		}

		c.FileFromFS("/", assets.EmbedFS())
	})

	if conf.TLS.Enabled {
		//go startTls(ge, tlsAddr, conf.TLS.Auto, conf.TLS.CacheDir, conf.Server.Domain, conf.TLS.CertPath, conf.TLS.CertkeyPath)
		go startTls(ge, conf)
	}

	addr := fmt.Sprintf(":%d", conf.Server.Port)
	ginutil.Startup(ge, addr)
}

func startTls(e *gin.Engine, conf *config.Config) {
	tlsAddr := fmt.Sprintf(":%d", conf.Server.SSLPort)
	if conf.TLS.Auto {
		m := autocert.Manager{
			Prompt: autocert.AcceptTOS,
		}
		if err := os.MkdirAll(conf.TLS.CacheDir, 0700); err != nil {
			log.Printf("autocert cache dir check failed: %s", err.Error())
		} else {
			m.Cache = autocert.DirCache(conf.TLS.CacheDir)
		}
		if len(conf.Server.Domain) > 0 {
			m.HostPolicy = autocert.HostWhitelist(conf.Server.Domain...)
		}
		srv := &http.Server{
			Addr:      tlsAddr,
			Handler:   e,
			TLSConfig: m.TLSConfig(),
		}
		go func() {
			log.Printf("[rest server listen at %s]", srv.Addr)
			if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				log.Fatalln(err)
			}
		}()

		httputil.SetupGracefulStop(srv)

	} else {
		srv := &http.Server{
			Addr:    tlsAddr,
			Handler: e,
		}
		go func() {
			log.Printf("[rest server listen tls at %s]", srv.Addr)
			if err := srv.ListenAndServeTLS(conf.TLS.CertPath, conf.TLS.CertkeyPath); err != nil && err != http.ErrServerClosed {
				log.Fatalln(err)
			}
		}()
		httputil.SetupGracefulStop(srv)
	}
}
