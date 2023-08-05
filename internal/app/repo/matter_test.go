package repo

import (
	"context"
	"database/sql/driver"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/stretchr/testify/assert"
)

func TestMatterDBQuery_PathExist(t *testing.T) {
	mock, db := newMockDB(t)
	q := NewMatterDBQuery(db)
	mock.ExpectQuery("SELECT").WithArgs("to", "path/")
	q.PathExist(context.Background(), "/path/to/")

	mock.ExpectQuery("SELECT").WithArgs("a.txt", "path/to/")
	q.PathExist(context.Background(), "/path/to/a.txt")

	mock.ExpectQuery("SELECT").WithArgs("path", "")
	q.PathExist(context.Background(), "/path")

	// we make sure that all expectations were met
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("there were unfulfilled expectations: %s", err)
	}
}

func TestMatterDBQuery_Update(t *testing.T) {
	testCases := map[string]struct {
		target *entity.Matter
		rows   *sqlmock.Rows

		expectChildrenArgs   []driver.Value // newParent, updated, oldParent
		expectChildrenResult driver.Result

		expectMainArgs   []driver.Value // name, parent, updated, id
		expectMainResult driver.Result
	}{
		"update name with children": {
			target: &entity.Matter{Id: 1, Name: "dir1-1", Parent: "dir0/", DirType: entity.DirTypeUser},
			rows: sqlmock.NewRows([]string{"id", "name", "parent", "dirtype"}).
				AddRow(1, "dir1", "dir0", 1),

			expectChildrenArgs:   []driver.Value{"dir0/dir1/", "dir0/dir1-1/", nowFunc(), "dir0/dir1/%"},
			expectChildrenResult: sqlmock.NewResult(1, 1),

			expectMainArgs:   []driver.Value{"dir1-1", "dir0/", nil, nowFunc(), 1},
			expectMainResult: sqlmock.NewResult(1, 1),
		},
		"update parent with children": {
			target: &entity.Matter{Id: 2, Name: "dir2", Parent: "dir1/", DirType: entity.DirTypeUser}, // 把dir2移动到目录dir1里
			rows: sqlmock.NewRows([]string{"id", "name", "parent", "dirtype"}).
				AddRow(2, "dir2", "", 2),

			expectChildrenArgs:   []driver.Value{"dir2/", "dir1/dir2/", nowFunc(), "dir2/%"},
			expectChildrenResult: sqlmock.NewResult(1, 1),

			expectMainArgs:   []driver.Value{"dir2", "dir1/", nil, nowFunc(), 2},
			expectMainResult: sqlmock.NewResult(1, 1),
		},
	}

	for name, tc := range testCases {
		t.Run(name, func(t *testing.T) {
			mock, db := newMockDB(t)
			mock.ExpectQuery("SELECT").WithArgs(tc.target.Id).
				WillReturnRows(tc.rows)

			mock.ExpectBegin()
			mock.ExpectExec("UPDATE").
				WithArgs(tc.expectChildrenArgs...).
				WillReturnResult(tc.expectChildrenResult)

			mock.ExpectExec("UPDATE").
				WithArgs(tc.expectMainArgs...).
				WillReturnResult(tc.expectMainResult)
			mock.ExpectCommit()

			q := NewMatterDBQuery(db)
			ctx := context.Background()
			assert.NoError(t, q.Update(ctx, tc.target.Id, tc.target))
		})
	}
}
