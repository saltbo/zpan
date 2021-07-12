package fakefs

import (
	"os"
	"testing"

	"github.com/saltbo/gopkg/strutil"
	"github.com/stretchr/testify/assert"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

func init() {
	os.Remove("zpan.db")
	dao.Init("sqlite3", "zpan.db")
	user := &model.User{
		Email:    "admin@zpan.space",
		Username: "admin",
		Password: strutil.Md5Hex("123"),
		Roles:    "admin",
		Ticket:   strutil.RandomText(6),
		Status:   model.StatusActivated,
	}
	dao.NewUser().Create(user, model.UserStorageDefaultSize)
	//clean before all
	//clean()
}

//func clean() {
//	gormutil.DB().Exec("delete from zp_matter where 1=1;")
//}

var fs = New()

func init() {
	fs.Start()
}

func TestPreSignPutURL(t *testing.T) {
	bf := &bind.BodyMatter{
		Name: "test.txt",
		Size: 0,
		Type: "text/plain",
		Dir:  "",
	}
	nm := bf.ToMatter(1)
	_, err := fs.CreateFile(nm)
	assert.NoError(t, err)

	m, err := fs.TagUploadDone(1, nm.Alias)
	assert.NoError(t, err)
	assert.Equal(t, nm.Name, m.Name)
	assert.Equal(t, nm.Size, m.Size)
	assert.Equal(t, nm.Type, m.Type)
	assert.Equal(t, nm.Parent, m.Parent)

	_, err = fs.CreateFileLink(m.Alias)
	assert.NoError(t, err)
}

func TestFileRename(t *testing.T) {
	m := model.NewMatter(1, 0, "test1.txt")
	assert.NoError(t, fs.dMatter.Create(m))

	newName := "test-new.txt"
	assert.NoError(t, fs.Rename(m.Uid, m.Alias, newName))
	nm, err := fs.dMatter.FindUserMatter(m.Uid, m.Alias)
	assert.NoError(t, err)
	assert.Equal(t, newName, nm.Name)
}

func TestFileCopy(t *testing.T) {
	fm := model.NewMatter(1, 0, "test-copy-dir")
	fm.DirType = model.DirTypeUser
	assert.NoError(t, NewFolder().Create(fm))

	m := model.NewMatter(1, 0, "test2.txt")
	assert.NoError(t, fs.dMatter.Create(m))
	assert.NoError(t, fs.Copy(m.Uid, m.Alias, fm.Name+"/"))
}

func TestFileMove(t *testing.T) {
	fm := model.NewMatter(1, 0, "test-move-dir")
	fm.DirType = model.DirTypeUser
	assert.NoError(t, NewFolder().Create(fm))

	m := model.NewMatter(1, 0, "test3.txt")
	assert.NoError(t, fs.dMatter.Create(m))
	assert.NoError(t, fs.Move(m.Uid, m.Alias, fm.Name+"/"))
}

func TestFileMoveFails(t *testing.T) {
	ems := []*model.Matter{
		{Uid: 1, Parent: "", Name: "move", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "move/", Name: "move", DirType: model.DirTypeUser},
		{Uid: 1, Parent: "", Name: "move.txt"},
		{Uid: 1, Parent: "move/", Name: "move.txt"},
	}

	for _, m := range ems {
		m.Alias = strutil.RandomText(8)
		assert.NoError(t, fs.dMatter.Create(m))
	}

	assert.Error(t, fs.Move(1, "ne.txt", "abc/"))              // Disable move a not exist file
	assert.Error(t, fs.Move(1, ems[1].Alias, ems[2].Name+"/")) // Disable move to non-folder directory
	assert.Error(t, fs.Move(1, ems[2].Alias, "abc/"))          // Disable move to not exist directory
	assert.Error(t, fs.Move(1, ems[3].Alias, ems[3].Parent))   // Disable move to the current directory
	assert.Error(t, fs.Move(1, ems[2].Alias, "move/"))         // Disable move to a directory with a file with the same name
}

func TestFileDelete(t *testing.T) {
	m := model.NewMatter(1, 0, "test4.txt")
	assert.NoError(t, fs.dMatter.Create(m))
	assert.NoError(t, fs.Delete(m.Uid, m.Alias))

	assert.Error(t, fs.Delete(1, "123"))
}
