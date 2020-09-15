package service

import (
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/zpan/model"
	"testing"
)

var dbc = gormutil.Config{
	Driver: "sqlite3",
	DSN:    "zpan.db",
}

var tests = []string{
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (6, 0, 'e7oiYavhggIEgu25', '.pics', '', 0, 1, '', '', 'protected', '2020-09-15 14:35:26.5349996+08:00', '2020-09-15 14:35:26.5349996+08:00', null, null)",
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (7, 0, '7UOCp7GtgS1dZTwo', 'a', '', 0, 2, '', '', 'protected', '2020-09-15 14:35:30.4243604+08:00', '2020-09-15 14:35:30.4243604+08:00', null, null)",
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (8, 0, 'JIEt4Ma4j8XsIezY', 'test', '', 0, 2, '', '', 'protected', '2020-09-15 14:35:34.4371281+08:00', '2020-09-15 14:35:34.4371281+08:00', null, null)",
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (9, 0, 'LT34YdJyrY7Jt1QB', 'b', '', 0, 2, 'a/', '', 'protected', '2020-09-15 14:35:38.2763311+08:00', '2020-09-15 14:35:38.2763311+08:00', null, null)",
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (10, 0, 'kcsPOWe7BUrjpAoR', 'c', '', 0, 2, 'a/b/', '', 'protected', '2020-09-15 14:35:43.5072506+08:00', '2020-09-15 14:35:43.5072506+08:00', null, null)",
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (11, 0, 'S4PRcIxJXDinCPDD', 'test2', '', 0, 2, 'test/', '', 'protected', '2020-09-15 14:35:49.0074705+08:00', '2020-09-15 14:35:49.0074705+08:00', null, null)",
	"INSERT INTO zp_matter (id, uid, alias, name, type, size, dirtype, parent, object, acl, created_at, updated_at, uploaded_at, deleted_at) VALUES (12, 0, 'Xn3t3NrPRK31lt6u', 'test2', '', 0, 2, '', '', 'protected', '2020-09-15 14:35:53.5863304+08:00', '2020-09-15 14:35:53.5863304+08:00', null, null)"}

func init() {
	gormutil.Init(dbc, false)
	gormutil.AutoMigrate(model.Tables())
	//clean before all
	clean()
}

func clean() {
	gormutil.DB().Exec("delete from zp_matter where 1=1;")
}

func importTestData() {
	for _, v := range tests {
		gormutil.DB().Exec(v)
	}
}

type P struct {
	uid    int64
	parent string
	file   *model.Matter
}

func TestCanMove(t *testing.T) {
	//
	defer clean()
	importTestData()
	tests := []struct {
		name    string
		args    P
		want    bool
		wantErr bool
	}{
		{
			name: "dir not exists",
			args: P{
				uid:    0,
				parent: "c/",
				file:   model.NewMatter(0, "a"),
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "move to itself",
			args: P{
				uid:    0,
				parent: "a/",
				file:   model.NewMatter(0, "a"),
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "move to itself(children)",
			args: P{
				uid:    0,
				parent: "a/b/",
				file:   model.NewMatter(0, "a"),
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "move to dir already exists same name file",
			args: P{
				uid:    0,
				parent: "test/",
				file:   model.NewMatter(0, "test2"),
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "normal operation",
			args: P{
				uid:    0,
				parent: "test/test2/",
				file:   model.NewMatter(0, "test2"),
			},
			want:    true,
			wantErr: false,
		},
		{
			name: "move to same place",
			args: P{
				uid:    0,
				parent: "",
				file:   model.NewMatter(0, "a"),
			},
			want:    false,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CanMove(tt.args.uid, tt.args.parent, tt.args.file)
			if (err != nil) != tt.wantErr {
				t.Errorf("CanMove() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("CanMove() got = %v, want %v", got, tt.want)
			}
		})
	}
}
