package vfs

import (
	"context"
	"testing"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
	"github.com/saltbo/zpan/internal/app/usecase/uploader"
	"github.com/saltbo/zpan/internal/mock"
	"github.com/stretchr/testify/assert"
)

var (
	mockUploader = map[string]any{
		"url": "https://example.com/upload",
	}
	mockMatters = []*entity.Matter{
		{},
	}
)

func TestVfs_Create_File(t *testing.T) {
	matter := &entity.Matter{
		Parent: "/",
		Name:   "abc.txt",
	}
	ctx := context.Background()
	mockMatter := mock.NewMatter()
	assert.NoError(t, mockMatter.Create(ctx, matter))
	vfs := NewVfs(mockMatter, nil, &uploader.FakeUploader{CreateUploadURLFn: func(ctx context.Context, m *entity.Matter) error {
		m.Uploader = mockUploader
		return nil
	}})

	assert.NoError(t, vfs.Create(context.Background(), matter))
	assert.Equal(t, "/abc.txt", matter.FullPath())
	assert.Equal(t, mockUploader, matter.Uploader)
}

func TestVfs_Create_Folder(t *testing.T) {
	matter := &entity.Matter{
		DirType: entity.DirTypeUser,
		Parent:  "/",
		Name:    "abc",
	}
	vfs := NewVfs(&mock.Matter{}, nil, nil)
	assert.NoError(t, vfs.Create(context.Background(), matter))
	assert.True(t, matter.IsDir())
	assert.Equal(t, "/abc/", matter.FullPath())
	assert.Empty(t, matter.Uploader)
}

func TestVfs_Rename(t *testing.T) {
	matter := &entity.Matter{
		Alias:  "test",
		Parent: "/",
		Name:   "abc.txt",
	}
	ctx := context.Background()
	mockMatter := mock.NewMatter()
	assert.NoError(t, mockMatter.Create(ctx, matter))
	vfs := NewVfs(mockMatter, nil, nil)
	assert.NoError(t, vfs.Rename(ctx, "test", "new.txt"))
	assert.Equal(t, "new.txt", matter.Name)
}

func TestVfs_Move(t *testing.T) {
	matter := &entity.Matter{
		Alias:  "test",
		Parent: "/",
		Name:   "abc.txt",
	}
	ctx := context.Background()
	mockMatter := mock.NewMatter()
	assert.NoError(t, mockMatter.Create(ctx, matter))
	vfs := NewVfs(mockMatter, nil, nil)
	assert.NoError(t, vfs.Move(context.Background(), "test", "newDir"))
	assert.Equal(t, "newDir/abc.txt", matter.FullPath())
}

func TestVfs_Copy(t *testing.T) {
	matter := &entity.Matter{
		Alias:  "test",
		Parent: "/",
		Name:   "abc.txt",
	}
	ctx := context.Background()
	mockMatter := mock.NewMatter()
	assert.NoError(t, mockMatter.Create(ctx, matter))
	vfs := NewVfs(mockMatter, nil, nil)
	newMatter, err := vfs.Copy(context.Background(), "test", "newDir")
	assert.NoError(t, err)
	assert.Equal(t, "newDir/abc.txt", newMatter.FullPath())
}

func TestVfs_Delete(t *testing.T) {
	matter := &entity.Matter{
		Alias:  "test",
		Parent: "/",
		Name:   "abc.txt",
	}

	ctx := context.Background()
	mockMatter := mock.NewMatter()
	assert.NoError(t, mockMatter.Create(ctx, matter))
	vfs := NewVfs(mockMatter, mock.NewRecycleBin(), nil)
	assert.NoError(t, vfs.Delete(ctx, "test"))
	_, err := vfs.Get(ctx, "test")
	assert.Error(t, err)

	rbs, total, err := vfs.recycleBinRepo.FindAll(ctx, &repo.RecycleBinFindOptions{})
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, rbs[0].Name, matter.Name)
}
