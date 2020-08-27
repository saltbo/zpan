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
//go:generate statik -src=../../zpan-front/dist -dest .. -p assets
package cmd

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/spf13/cobra"

	_ "github.com/saltbo/zpan/assets"
	"github.com/saltbo/zpan/config"
	"github.com/saltbo/zpan/disk"
	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/rest"
)

// serverCmd represents the server command
var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "A cloud disk base on the cloud service.",
	Run: func(cmd *cobra.Command, args []string) {
		conf := config.Parse()
		gormutil.Init(conf.Database,
			&model.Matter{},
			&model.Share{},
			&model.Storage{},
		)
		gormutil.Debug()

		fmt.Println(conf.Provider)
		diskProvider, err := disk.New(conf.Provider)
		if err != nil {
			log.Fatalln(err)
		}

		ge := gin.Default()
		ginutil.SetupEmbedAssets(ge.Group("/"),
			"/css", "/js", "/fonts")

		simpleRouter := ginutil.NewSimpleRouter()
		simpleRouter.StaticFS("/", ginutil.EmbedFS())

		ginutil.SetupResource(ge.Group("/api"),
			rest.NewFileResource(conf.Provider.Bucket, diskProvider),
			rest.NewShareResource(),
			rest.NewURLResource(conf, diskProvider),
			rest.NewStorageResource(),
		)

		ge.NoRoute(simpleRouter.Handler)
		ginutil.Startup(ge, ":8222")
	},
}

func init() {
	rootCmd.AddCommand(serverCmd)

	// Here you will define your flags and configuration settings.

	// Cobra supports Persistent Flags which will work for this command
	// and all subcommands, e.g.:
	// serverCmd.PersistentFlags().String("foo", "", "A help for foo")

	// Cobra supports local flags which will only run when this command
	// is called directly, e.g.:
	// serverCmd.Flags().BoolP("toggle", "t", false, "Help message for toggle")
}
