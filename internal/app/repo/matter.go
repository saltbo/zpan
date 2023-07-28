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

type MatterListOption struct {
	QueryPage
	Sid     int64  `form:"sid" binding:"required"`
	Uid     int64  `form:"uid"`
	Dir     string `form:"dir"`
	Type    string `form:"type"`
	Keyword string `form:"kw"`
}

type MatterFindWithOption struct {
	Id      int64
	Alias   string
	Deleted bool
}

type Matter interface {
	BasicOP[*entity.Matter, int64, *MatterListOption]

	FindWith(ctx context.Context, opt *MatterFindWithOption) (*entity.Matter, error)
	FindByAlias(ctx context.Context, alias string) (*entity.Matter, error)
	PathExist(ctx context.Context, path string) bool
	Copy(ctx context.Context, id int64, to string) (*entity.Matter, error)
	Recovery(ctx context.Context, id int64) error
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

func (db *MatterDBQuery) FindWith(ctx context.Context, opt *MatterFindWithOption) (*entity.Matter, error) {
	conds := make([]gen.Condition, 0)
	if opt.Id != 0 {
		conds = append(conds, db.q.Matter.Id.Eq(opt.Id))
	}
	if opt.Alias != "" {
		conds = append(conds, db.q.Matter.Alias_.Eq(opt.Alias))
	}

	q := db.q.Matter.WithContext(ctx)
	if opt.Deleted {
		q = q.Unscoped()
	}

	return q.Where(conds...).First()
}

func (db *MatterDBQuery) FindByAlias(ctx context.Context, alias string) (*entity.Matter, error) {
	return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Alias_.Eq(alias)).First()
}

func (db *MatterDBQuery) PathExist(ctx context.Context, filepath string) bool {
	if filepath == "" {
		return true
	}

	_, err := db.q.Matter.WithContext(ctx).Where(
		db.q.Matter.Parent.Eq(path.Dir(filepath)),
		db.q.Matter.Name.Eq(path.Base(filepath))).First()
	return err == nil
}

func (db *MatterDBQuery) FindAll(ctx context.Context, opts *MatterListOption) ([]*entity.Matter, int64, error) {
	conds := make([]gen.Condition, 0)
	if opts.Uid != 0 {
		conds = append(conds, db.q.Matter.Uid.Eq(opts.Uid))
	}
	if opts.Sid != 0 {
		conds = append(conds, db.q.Matter.Sid.Eq(opts.Sid))
	}
	if opts.Dir != "" {
		conds = append(conds, db.q.Matter.Parent.Eq(opts.Dir))
	}
	if opts.Keyword != "" {
		conds = append(conds, db.q.Matter.Name.Like(fmt.Sprintf("%%%s%%", opts.Keyword)))
	}
	if opts.Type == "doc" {
		conds = append(conds, db.q.Matter.Type.In(entity.DocTypes...))
	} else if opts.Type != "" {
		conds = append(conds, db.q.Matter.Type.Like(fmt.Sprintf("%%%s%%", opts.Type)))
	}

	return db.q.Matter.Where(conds...).Order(db.q.Matter.DirType.Desc()).FindByPage(opts.Offset, opts.Limit)
}

func (db *MatterDBQuery) Create(ctx context.Context, m *entity.Matter) error {
	if exist := db.PathExist(ctx, m.FullPath()); exist {
		return fmt.Errorf("matter %s already exist", m.FullPath())
	}

	if exist := db.PathExist(ctx, m.Parent); !exist {
		return fmt.Errorf("base dir not exist")
	}

	return db.q.Matter.Create(m)
}

func (db *MatterDBQuery) Copy(ctx context.Context, id int64, to string) (*entity.Matter, error) {
	em, err := db.Find(ctx, id)
	if err != nil {
		return nil, err
	}

	if exist := db.PathExist(ctx, path.Join(to, em.Name)); exist {
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

	matters = append(matters, m)
	_, err = db.q.Matter.Delete(matters...)
	return err
}

func (db *MatterDBQuery) Recovery(ctx context.Context, id int64) error {
	m, err := db.q.Matter.WithContext(ctx).Unscoped().Where(db.q.Matter.Id.Eq(id)).First()
	if err != nil {
		return err
	}

	m.DeletedAt = gorm.DeletedAt{}
	return db.q.Matter.WithContext(ctx).Unscoped().Where(db.q.Matter.Id.Eq(m.Id)).Save(m)
}

func (db *MatterDBQuery) GetObjects(ctx context.Context, id int64) ([]string, error) {
	m, err := db.Find(ctx, id)
	if err != nil {
		return nil, err
	}

	if !m.IsDir() {
		return []string{m.Object}, nil
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
	if m.Parent == "" {
		return []*entity.Matter{}, nil
	}

	return db.q.Matter.WithContext(ctx).Where(db.q.Matter.Parent.Like(m.Parent + "%")).Find()
}
