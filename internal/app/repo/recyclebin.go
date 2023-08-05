package repo

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
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
	DBQuery
}

func NewRecycleBinDBQuery(q DBQuery) *RecycleBinDBQuery {
	return &RecycleBinDBQuery{DBQuery: q}
}

func (r *RecycleBinDBQuery) Find(ctx context.Context, alias string) (*entity.RecycleBin, error) {
	return r.Q().RecycleBin.WithContext(ctx).Where(r.Q().RecycleBin.Alias_.Eq(alias)).First()
}

func (r *RecycleBinDBQuery) FindAll(ctx context.Context, opts *RecycleBinFindOptions) (rows []*entity.RecycleBin, total int64, err error) {
	q := r.Q().RecycleBin.WithContext(ctx).Where(r.Q().RecycleBin.Uid.Eq(opts.Uid), r.Q().RecycleBin.Sid.Eq(opts.Sid)).Order(r.Q().RecycleBin.Id.Desc())

	if opts.Limit == 0 {
		rows, err = q.Find()
		return
	}

	return q.FindByPage(opts.Offset, opts.Limit)
}

func (r *RecycleBinDBQuery) Create(ctx context.Context, m *entity.RecycleBin) error {
	return r.Q().RecycleBin.WithContext(ctx).Create(m)
}

func (r *RecycleBinDBQuery) Delete(ctx context.Context, alias string) error {
	m, err := r.Find(ctx, alias)
	if err != nil {
		return err
	}

	_, err = r.Q().RecycleBin.WithContext(ctx).Delete(m)
	return err
}
