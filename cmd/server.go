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
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/moreu/moreu"
	"github.com/spf13/cobra"

	"github.com/saltbo/zpan/assets"
	"github.com/saltbo/zpan/config"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest"
	"github.com/saltbo/zpan/service"
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
	service.UserStorageInit(conf.Storage)

	ge := gin.Default()
	mu := moreu.New(ge, gormutil.DB())
	if conf.EmailAct() {
		mu.SetupMail(conf.Email)
	}

	mu.SetupAPI(conf.EmailAct(), conf.Invitation)
	mu.SetupEmbedStatic()
	ge.Use(mu.Auth(rest.Roles()))

	apiRouter := ge.Group("/api")
	apiRouter.Use(rest.UserInjector())
	ginutil.SetupResource(apiRouter,
		rest.NewUserResource(),
		rest.NewFileResource(conf.Provider),
		rest.NewFolderResource(conf.Provider),
		rest.NewShareResource(),
	)

	ginutil.SetupEmbedAssets(ge.Group("/"),
		assets.EmbedFS(), "/css", "/js", "/fonts")
	ge.NoRoute(mu.NoRoute, func(c *gin.Context) {
		c.FileFromFS("/", assets.EmbedFS())
	})

	ginutil.Startup(ge, ":8222")
}
