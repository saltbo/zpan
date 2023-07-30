package repo

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo/query"
)

type RecycleBinFindOptions struct {
	QueryPage

	Sid int64
	Uid int64
}

type RecycleBin interface {
	Reader[*entity.RecycleBin, string, *RecycleBinFindOptions]
	Creator[*entity.RecycleBin]
	Deleter[string]
}

var _ RecycleBin = (*RecycleBinDBQuery)(nil)

type RecycleBinDBQuery struct {
	q *query.Query
}

func NewRecycleBinDBQuery(q *query.Query) *RecycleBinDBQuery {
	return &RecycleBinDBQuery{q: q}
}

func (r *RecycleBinDBQuery) Find(ctx context.Context, alias string) (*entity.RecycleBin, error) {
	return r.q.RecycleBin.WithContext(ctx).Where(r.q.RecycleBin.Alias_.Eq(alias)).First()
}

func (r *RecycleBinDBQuery) FindAll(ctx context.Context, opts *RecycleBinFindOptions) (rows []*entity.RecycleBin, total int64, err error) {
	q := r.q.RecycleBin.WithContext(ctx).Where(r.q.RecycleBin.Uid.Eq(opts.Uid), r.q.RecycleBin.Sid.Eq(opts.Sid)).Order(r.q.RecycleBin.Id.Desc())

	if opts.Limit == 0 {
		rows, err = q.Find()
		return
	}

	return q.FindByPage(opts.Offset, opts.Limit)
}

func (r *RecycleBinDBQuery) Create(ctx context.Context, m *entity.RecycleBin) error {
	return r.q.RecycleBin.WithContext(ctx).Create(m)
}

func (r *RecycleBinDBQuery) Delete(ctx context.Context, alias string) error {
	m, err := r.Find(ctx, alias)
	if err != nil {
		return err
	}

	_, err = r.q.RecycleBin.WithContext(ctx).Delete(m)
	return err
}
