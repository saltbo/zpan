package repo

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/saltbo/zpan/internal/app/repo/query"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var nowFunc = func() time.Time {
	return time.Unix(0, 0)
}

func newMockDB(t *testing.T) (sqlmock.Sqlmock, DBQuery) {
	rdb, mock, err := sqlmock.New()
	assert.NoError(t, err)
	gdb, err := gorm.Open(mysql.New(mysql.Config{Conn: rdb, DriverName: "mysql", SkipInitializeWithVersion: true}), &gorm.Config{
		NowFunc: nowFunc,
	})
	assert.NoError(t, err)
	return mock, NewDBQueryFactory(query.Use(gdb.Debug()))
}
