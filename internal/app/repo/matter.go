package repo

import (
	"context"
	"fmt"
	"path"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo/query"
	"github.com/samber/lo"
	"gorm.io/gen"
	"gorm.io/gorm"
)

type ListOption struct {
	QueryPage
	Sid     int64  `form:"sid" binding:"required"`
	Uid     int64  `form:"uid"`
	Dir     string `form:"dir"`
	Type    string `form:"type"`
	Keyword string `form:"kw"`
}

type Matter interface {
	BasicOP[*entity.Matter, int64, *ListOption]

	FindByAlias(ctx context.Context, alias string) (*entity.Matter, error)
	FindByPath(ctx context.Context, path string) (*entity.Matter, error)
	Copy(ctx context.Context, id int64, to string) (*entity.Matter, error)
	Recovery(ctx context.Context, mid int64) error
	GetObjects(ctx context.Context, id int64) ([]string, error)
}

var _ Matter = (*MatterDBQuery)(nil)

type MatterDBQuery struct {
	q *query.Query
}

func NewMatterDBQuery(q *query.Query) *MatterDBQuery {
	return &MatterDBQuery{q: q}
}

func (db *MatterDBQuery) Find(ctx context.Context, id int64) (*entity.Matter, error) {
	return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Id.Eq(id)).First()
}

func (db *MatterDBQuery) FindByAlias(ctx context.Context, alias string) (*entity.Matter, error) {
	return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Alias_.Eq(alias)).First()
}

func (db *MatterDBQuery) FindByPath(ctx context.Context, filepath string) (*entity.Matter, error) {
	return db.q.Matter.WithContext(ctx).Where(
		db.q.Matter.Parent.Eq(path.Dir(filepath)),
		db.q.Matter.Name.Eq(path.Base(filepath))).First()
}

func (db *MatterDBQuery) FindAll(ctx context.Context, opts *ListOption) ([]*entity.Matter, int64, error) {
	conds := make([]gen.Condition, 0)
	return db.q.Matter.Where(conds...).Order(db.q.Matter.DirType.Desc()).FindByPage(opts.Offset, opts.Limit)
}

func (db *MatterDBQuery) Create(ctx context.Context, m *entity.Matter) error {
	if _, err := db.FindByPath(ctx, m.FullPath()); err == nil {
		return fmt.Errorf("matter already exist")
	}

	if _, err := db.FindByPath(ctx, m.Parent); err != nil {
		return fmt.Errorf("base dir not exist")
	}

	return db.q.Matter.Create(m)
}

func (db *MatterDBQuery) Copy(ctx context.Context, id int64, to string) (*entity.Matter, error) {
	em, err := db.Find(ctx, id)
	if err != nil {
		return nil, err
	}

	if _, err := db.FindByPath(ctx, path.Join(to, em.Name)); err == nil {
		return nil, fmt.Errorf("dir already has the same name file")
	}

	newMatter := em.Clone()
	newMatter.Parent = to
	if !em.IsDir() {
		// 如果是文件则只创建新的文件即可
		return newMatter, db.q.Matter.Create(newMatter)
	}

	// 如果是文件夹则查找所有子文件/文件夹一起复制
	matters, err := db.findChildren(ctx, em)
	if err != nil {
		return nil, err
	}

	newMatters := lo.Map(matters, func(item *entity.Matter, index int) *entity.Matter {
		newMatter := em.Clone()
		newMatter.Parent = to
		return newMatter
	})

	return newMatter, db.q.Matter.Create(newMatters...)
}

func (db *MatterDBQuery) Update(ctx context.Context, id int64, m *entity.Matter) error {
	em, err := db.Find(ctx, id)
	if err != nil {
		return err
	}

	// 如果没有修改目录则只更改自身
	if m.Parent == em.Parent {
		return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Id.Eq(id)).Save(m)
	}

	// 如果修改了目录，则需要把关联的matter的子目录都改掉
	matters, err := db.findChildren(ctx, em)
	if err != nil {
		return err
	}

	matters = lo.Map(matters, func(item *entity.Matter, index int) *entity.Matter {
		item.Parent = m.Parent
		return item
	})

	return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Id.Eq(id)).Save(matters...)
}

func (db *MatterDBQuery) Delete(ctx context.Context, id int64) error {
	m, err := db.Find(ctx, id)
	if err != nil {
		return err
	}

	matters, err := db.findChildren(ctx, m)
	if err != nil {
		return err
	}

	_, err = db.q.Matter.Delete(matters...)
	return err
}

func (db *MatterDBQuery) Recovery(ctx context.Context, id int64) error {
	m, err := db.q.Matter.WithContext(ctx).Unscoped().Where(db.q.Matter.Id.Eq(id)).First()
	if err != nil {
		return err
	}

	m.DeletedAt = gorm.DeletedAt{}
	return db.q.Matter.WithContext(ctx).Unscoped().Where(db.q.Matter.Id.Eq(id)).Save(m)
}

func (db *MatterDBQuery) GetObjects(ctx context.Context, id int64) ([]string, error) {
	m, err := db.Find(ctx, id)
	if err != nil {
		return nil, err
	}

	matters, err := db.findChildren(ctx, m)
	if err != nil {
		return nil, err
	}

	return lo.Map(lo.Filter(matters, func(item *entity.Matter, index int) bool {
		return item.Object != ""
	}), func(item *entity.Matter, index int) string {
		return item.Object
	}), nil
}

func (db *MatterDBQuery) findChildren(ctx context.Context, m *entity.Matter) ([]*entity.Matter, error) {
	return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Parent.Like(m.Parent + "%")).Find()
}
