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
	"log"
	"os"
	"os/exec"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/fileutil"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
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

	ge := gin.Default()
	ginutil.SetupEmbedAssets(ge.Group("/"), assets.EmbedFS(),
		"/css", "/js", "/fonts")

	simpleRouter := ginutil.NewSimpleRouter()
	simpleRouter.StaticFsIndex("/", assets.EmbedFS())
	ge.NoRoute(simpleRouter.Handler)
	ge.Use(rest.UserInjector())

	gormutil.Init(conf.Database, conf.Debug)
	gormutil.SetupPrefix("zp_")
	gormutil.AutoMigrate(model.Tables())

	service.UserStorageInit(conf.Storage)
	ginutil.SetupResource(ge.Group("/api"),
		rest.NewUserResource(),
		rest.NewFileResource(conf.Provider),
		rest.NewFolderResource(),
		rest.NewShareResource(),
	)

	fc := func() {
		go ginutil.Startup(ge, ":8222")
	}

	if err := moreuRun(conf, fc); err != nil {
		log.Fatalln(err)
	}
}

func moreuRun(c *config.Config, callback func()) error {
	var moreuCfgDir string
	dirs := []string{"deployments/.moreu/", "/etc/zpan/.moreu/"}
	for _, dir := range dirs {
		if fileutil.PathExist(dir) {
			moreuCfgDir = dir
			moreuCfgDir = dir
			break
		}
	}

	oc := exec.Command("moreu",
		"server",
		"--invitation="+strconv.FormatBool(c.Invitation),
		"--db-driver", c.Database.Driver,
		"--db-dsn", c.Database.DSN,
		"--email-host", c.Email.Host,
		"--email-sender", c.Email.Sender,
		"--email-username", c.Email.Username,
		"--email-password", c.Email.Password,
		"--grbac-config", moreuCfgDir+"roles.yml",
		"--proxy-config", moreuCfgDir+"routers.yml",
	)

	oc.Stdout = os.Stdout
	oc.Stderr = os.Stderr
	if err := oc.Start(); err != nil {
		return err
	}

	callback()
	return oc.Wait()
}
