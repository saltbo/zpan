package service

import (
	"fmt"
	"strings"

	"github.com/saltbo/zpan/model"
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

type MatterQuery struct {
	query  string
	params []interface{}
}

func NewMatterQuery(uid int64) *MatterQuery {
	return &MatterQuery{
		query:  "uid=? and (dirtype=? or (dirtype = 0 and uploaded_at is not null))",
		params: []interface{}{uid, model.DirTypeUser},
	}
}

func (m *MatterQuery) SetDir(dir string) {
	m.query += " and parent=?"
	m.params = append(m.params, dir)
}

func (m *MatterQuery) SetType(mt string) {
	if mt == "doc" {
		m.query += " and `type` in ('" + strings.Join(docTypes, "','") + "')"
	} else if mt != "" {
		m.query += " and type like ?"
		m.params = append(m.params, mt+"%")
	}
}

func (m *MatterQuery) SetKeyword(kw string) {
	m.query += " and name like ?"
	m.params = append(m.params, fmt.Sprintf("%%%s%%", kw))
}
