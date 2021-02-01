package service

import (
	"testing"

	"github.com/saltbo/gopkg/strutil"
	"github.com/stretchr/testify/assert"

	"github.com/saltbo/zpan/internal/app/model"
)

var folder = NewFolder()

func TestFolder_Rename(t *testing.T) {
	m := model.NewMatter(1, 0, "folder-test1")
	m.DirType = model.DirTypeUser
	assert.NoError(t, folder.Create(m))

	newName := "folder-test-new"
	assert.NoError(t, folder.Rename(m.Uid, m.Alias, newName))
	assert.Error(t, folder.Rename(m.Uid, m.Alias, newName))

	nm, err := folder.FindUserMatter(m.Uid, m.Alias)
	assert.NoError(t, err)
	assert.Equal(t, newName, nm.Name)
}

func TestFolder_RenameNotEmpty(t *testing.T) {
	ems := []*model.Matter{
		{Uid: 1,Parent: "", Name: "rename", DirType: model.DirTypeUser},
		{Uid: 1,Parent: "rename/", Name: "rename", DirType: model.DirTypeUser},
		{Uid: 1,Parent: "rename/rename/", Name: "rename1.txt"},
		{Uid: 1,Parent: "rename/rename/", Name: "rename2.txt"},
	}

	for _, m := range ems {
		m.Alias = strutil.RandomText(8)
		assert.NoError(t, fs.Create(m))
	}

	newName := "rename-new"
	assert.NoError(t, folder.Rename(1, ems[0].Alias, newName))

	ems[0].Name = newName
	children, err := folder.FindChildren(ems[0].Uid, ems[0].FullPath())
	assert.NoError(t, err)
	assert.Len(t, children, 3)
}

func TestFolder_Move(t *testing.T) {
	fm := model.NewMatter(1, 0, "test-move-dir2")
	fm.DirType = model.DirTypeUser
	assert.NoError(t, NewFolder().Create(fm))

	m := model.NewMatter(1, 0, "test-move-dir3")
	m.DirType = model.DirTypeUser
	assert.NoError(t, folder.Create(m))
	assert.NoError(t, folder.Move(m.Uid, m.Alias, fm.Name+"/"))
}

func TestFolder_MoveWithNotEmpty(t *testing.T) {
	ems := []*model.Matter{
		{Uid: 1,Parent: "", Name: "f-move", DirType: model.DirTypeUser},
		{Uid: 1,Parent: "", Name: "f-move2", DirType: model.DirTypeUser},
		{Uid: 1,Parent: "f-move/", Name: "move", DirType: model.DirTypeUser},
		{Uid: 1,Parent: "f-move/move/", Name: "move1.txt"},
		{Uid: 1,Parent: "f-move/move/", Name: "move2.txt"},
	}
	for _, m := range ems {
		m.Alias = strutil.RandomText(8)
		assert.NoError(t, fs.Create(m))
	}

	assert.NoError(t, folder.Move(1, ems[0].Alias, ems[1].Name+"/"))

	children, err := folder.FindChildren(ems[1].Uid, ems[1].FullPath())
	assert.NoError(t, err)
	assert.Len(t, children, 4)
}

func TestFolder_MoveFails(t *testing.T) {
	ems := []*model.Matter{
		{Uid: 1, Parent: "", Name: "ff-move", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "", Name: "move2", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "ff-move/", Name: "move2", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "ff-move/move2/", Name: "move1.txt"},
		{Uid: 1, Parent: "ff-move/move2/", Name: "move2.txt"},
	}
	for _, m := range ems {
		m.Alias = strutil.RandomText(8)
		assert.NoError(t, fs.Create(m))
	}

	assert.Error(t, folder.Move(1, ems[3].Alias, ""))             // Only support move the direction
	assert.Error(t, folder.Move(1, ems[0].Alias, ems[0].Parent))  // Disable move to the same direction
	assert.Error(t, folder.Move(1, ems[0].Alias, "ff-move/move")) // Disable move to own subdirectories
	assert.Error(t, folder.Move(1, ems[0].Alias, "abc/"))         // Disable move to the not exist direction
	assert.Error(t, folder.Move(1, ems[1].Alias, ems[2].Parent))  // Disable move to a directory with a file with the same name
}

func TestFolder_Remove(t *testing.T) {
	ems := []*model.Matter{
		{Uid: 1, Parent: "", Name: "remove", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "remove/", Name: "remove", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "remove/remove/", Name: "remove-1.txt"},
		{Uid: 1, Parent: "remove/remove/", Name: "remove-2.txt"},
	}
	for _, m := range ems {
		m.Alias = strutil.RandomText(8)
		assert.NoError(t, fs.Create(m))
	}

	assert.NoError(t, folder.Remove(1, ems[0].Alias))
}
