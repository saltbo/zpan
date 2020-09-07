//go:generate statik -p assets -ns zpan -src=../../zpan-front/dist -dest ..

package assets

import (
	"log"
	"net/http"

	"github.com/rakyll/statik/fs"
)

func EmbedFS() http.FileSystem {
	efs, err := fs.NewWithNamespace(Zpan)
	if err != nil {
		log.Fatalln(err)
	}

	return efs
}
