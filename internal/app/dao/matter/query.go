package matter

import (
	"fmt"
	"strings"

	"github.com/saltbo/zpan/internal/app/model"
)

var docTypes = []string{
	"text/csv",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

type Query struct {
	SQL    string
	Params []interface{}
}

func NewQuery(uid int64, opts ...QueryOption) *Query {
	q := &Query{
		SQL:    "uid=? and (dirtype=? or (dirtype = 0 and uploaded_at is not null))",
		Params: []interface{}{uid, model.DirTypeUser},
	}

	for _, opt := range opts {
		opt(q)
	}

	return q
}

type QueryOption func(*Query)

func WithSid(sid int64) QueryOption {
	return func(m *Query) {
		m.SQL += " and sid=?"
		m.Params = append(m.Params, sid)
	}
}

func WithDir(dir string) QueryOption {
	return func(m *Query) {
		m.SQL += " and parent=?"
		m.Params = append(m.Params, dir)
	}
}

func WithKeyword(kw string) QueryOption {
	return func(m *Query) {
		m.SQL += " and name like ?"
		m.Params = append(m.Params, fmt.Sprintf("%%%s%%", kw))
	}
}

func WithType(mt string) QueryOption {
	return func(m *Query) {
		if mt == "doc" {
			m.SQL += " and `type` in ('" + strings.Join(docTypes, "','") + "')"
		} else if mt != "" {
			m.SQL += " and type like ?"
			m.Params = append(m.Params, mt+"%")
		}
	}
}
