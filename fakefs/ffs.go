package fakefs

import "github.com/saltbo/zpan/service"

type FakeFS struct {
	service.Folder
	service.File
}
