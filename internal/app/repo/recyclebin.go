package repo

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo/query"
)

type RecycleBinFindOptions struct {
	QueryPage
}

type RecycleBin interface {
	Reader[*entity.RecycleBin, string, RecycleBinFindOptions]
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

func (r *RecycleBinDBQuery) FindAll(ctx context.Context, opts RecycleBinFindOptions) ([]*entity.RecycleBin, int64, error) {
	return r.q.RecycleBin.WithContext(ctx).FindByPage(opts.Offset, opts.Limit)
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
