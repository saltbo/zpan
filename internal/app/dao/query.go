package dao

import (
	"fmt"
	"strings"
)

type Query struct {
	conditions []string
	Params     []interface{}
	Offset     int
	Limit      int
}

func NewQuery() *Query {
	q := &Query{
		conditions: make([]string, 0),
		Params:     make([]interface{}, 0),
	}

	return q
}

func (q *Query) WithPage(pageNo, pageSize int64) {
	offset := (pageNo - 1) * pageSize
	q.Offset = int(offset)
	q.Limit = int(pageSize)
}

func (q *Query) WithEq(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s=?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) WithNe(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s!=?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) WithGt(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s>?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) WithGte(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s>=?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) WithLt(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s<?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) WithLte(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s<=?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) WithLike(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s like ?", k))
	q.Params = append(q.Params, fmt.Sprintf("%%%s%%", v))
}

// todo test me
func (q *Query) WithIn(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s in ?", k))
	q.Params = append(q.Params, v)
}

// todo test me
func (q *Query) WithNin(k, v interface{}) {
	q.conditions = append(q.conditions, fmt.Sprintf("%s not in ?", k))
	q.Params = append(q.Params, v)
}

func (q *Query) SQL() string {
	return strings.Join(q.conditions, " and ")
}
