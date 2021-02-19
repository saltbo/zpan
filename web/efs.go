package web

import (
	"embed"
	"net/http"
	"os"
	"path/filepath"
)

//go:embed dist/*
var embedFs embed.FS

type FileSystem struct {
	efs http.FileSystem
}

func NewFS() *FileSystem {
	return &FileSystem{http.FS(embedFs)}
}

func (fs FileSystem) Open(name string) (http.File, error) {
	f, err := fs.efs.Open(filepath.Join("dist", name))
	if os.IsNotExist(err) {
		return fs.efs.Open("dist/index.html") // SPA应用需要始终加载index.html
	}

	return f, err
}
