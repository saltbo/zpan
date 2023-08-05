package repo

import (
	"context"

	"github.com/saltbo/zpan/internal/app/repo/query"
)

type QueryPage struct {
	Offset int `form:"offset"`
	Limit  int `form:"limit,default=500"`
}

type Opt[p any] interface {
	apply(*p)
}

type IDType interface {
	int64 | string
}

type BasicOP[T comparable, ID IDType, O any] interface {
	Writer[T, ID]
	Reader[T, ID, O]
}

type Writer[T comparable, ID IDType] interface {
	Creator[T]
	Updater[T, ID]
	Deleter[ID]
}

type Reader[T comparable, ID IDType, O any] interface {
	Find(ctx context.Context, id ID) (T, error)
	FindAll(ctx context.Context, opts O) ([]T, int64, error)
}

type Creator[T comparable] interface {
	Create(ctx context.Context, entity T) error
}

type Updater[T comparable, ID IDType] interface {
	Update(ctx context.Context, id ID, entity T) error
}

type Deleter[ID IDType] interface {
	Delete(ctx context.Context, id ID) error
}

type DBQuery interface {
	Q() *query.Query
}

type DBQueryFactory struct {
	q *query.Query
}

func NewDBQueryFactory(q *query.Query) *DBQueryFactory {
	return &DBQueryFactory{q: q}
}

func (f *DBQueryFactory) Q() *query.Query {
	return f.q
}
