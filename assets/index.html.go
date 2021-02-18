package assets

import (
	"embed"
	"fmt"
	"net/http"
	"os"
)

//go:embed css/* fonts/* img/* js/*
//go:embed 404.html
//go:embed index.html
var content embed.FS

type FileSystem struct {
	efs http.FileSystem
}

func NewFS() *FileSystem {
	return &FileSystem{http.FS(content)}
}

func (fs FileSystem) Open(name string) (http.File, error) {
	f, err := fs.efs.Open(name)
	if os.IsNotExist(err) {
		fmt.Println(name)
		return fs.efs.Open("/index.html") // SPA应用需要始终加载index.html
	}

	return f, err
}