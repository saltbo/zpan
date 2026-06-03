package engine

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func ZipDirectory(sourceDir string, destination string) (int64, error) {
	out, err := os.Create(destination)
	if err != nil {
		return 0, err
	}
	defer out.Close()

	archive := zip.NewWriter(out)
	defer archive.Close()

	if err := filepath.WalkDir(sourceDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Clean(path) == filepath.Clean(destination) {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".") {
			return nil
		}

		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		writer, err := archive.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		_, err = io.Copy(writer, file)
		return err
	}); err != nil {
		return 0, err
	}
	if err := archive.Close(); err != nil {
		return 0, err
	}
	if err := out.Close(); err != nil {
		return 0, err
	}
	info, err := os.Stat(destination)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}
