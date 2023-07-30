package repo

import (
	"context"
	"fmt"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/saltbo/gopkg/timeutil"
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
	Draft   bool
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

	var name, parent string
	if strings.HasSuffix(filepath, "/") {
		name = path.Base(filepath)
		parent = strings.TrimSuffix(filepath, name+"/")
	} else {
		parent, name = path.Split(filepath)
	}

	conds := []gen.Condition{db.q.Matter.Name.Eq(name)}
	if parent != name {
		conds = append(conds, db.q.Matter.Parent.Eq(strings.TrimPrefix(parent, "/")))
	}

	_, err := db.q.Matter.WithContext(ctx).Where(conds...).First()
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

	if opts.Keyword != "" {
		conds = append(conds, db.q.Matter.Name.Like(fmt.Sprintf("%%%s%%", opts.Keyword)))
	} else if !opts.Draft {
		conds = append(conds, db.q.Matter.Parent.Eq(opts.Dir))
	}

	if opts.Type == "doc" {
		conds = append(conds, db.q.Matter.Type.In(entity.DocTypes...))
	} else if opts.Type != "" {
		conds = append(conds, db.q.Matter.Type.Like(fmt.Sprintf("%%%s%%", opts.Type)))
	}

	if !opts.Draft {
		conds = append(conds, db.q.Matter.UploadedAt.IsNotNull())
	}

	q := db.q.Matter.WithContext(ctx).Where(conds...).Order(db.q.Matter.DirType.Desc(), db.q.Matter.Id.Desc())
	if opts.Limit != 0 {
		return q.FindByPage(opts.Offset, opts.Limit)
	}

	matters, err := q.Find()
	return matters, int64(len(matters)), err
}

func (db *MatterDBQuery) Create(ctx context.Context, m *entity.Matter) error {
	if exist := db.PathExist(ctx, m.Parent); !exist {
		return fmt.Errorf("base dir not exist")
	}

	if exist := db.PathExist(ctx, m.FullPath()); exist {
		// auto append a suffix if matter exist
		ext := filepath.Ext(m.Name)
		suffix := fmt.Sprintf("_%s", timeutil.Format(time.Now(), "YYYYMMDD_HHmmss"))
		m.Name = strings.TrimSuffix(m.Name, ext) + suffix + ext
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
	matters, err := db.findChildren(ctx, em, false)
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

	return db.q.Transaction(func(tx *query.Query) error {
		tq := tx.Matter.WithContext(ctx)
		if m.IsDir() {
			// 如果是目录，则需要把该目录下的子文件/目录一并修改
			cond := tx.Matter.Parent.Like(em.FullPath() + "%")
			updated := map[string]any{"parent": gorm.Expr("REPLACE(parent, ?, ?)", em.FullPath(), m.FullPath())}
			if _, err := tq.Select(tx.Matter.Parent).Where(cond).Updates(updated); err != nil {
				return err
			}
		}

		_, err := tq.Select(tx.Matter.Name, tx.Matter.Parent, tx.Matter.UploadedAt).Updates(m)
		return err
	})
}

func (db *MatterDBQuery) Delete(ctx context.Context, id int64) error {
	m, err := db.Find(ctx, id)
	if err != nil {
		return err
	}

	m.TrashedBy = uuid.New().String()
	return db.q.Transaction(func(tx *query.Query) error {
		tq := tx.Matter.WithContext(ctx)
		if m.IsDir() {
			// 如果是目录，则需要把该目录下的子文件/目录一并删除
			cond := tx.Matter.Parent.Like(m.Name + "/%")
			if _, err := tq.Where(cond).Update(tx.Matter.TrashedBy, m.TrashedBy); err != nil {
				return err
			}
			if _, err := tq.Where(cond).Delete(); err != nil {
				return err
			}
		}

		if _, err := tq.Select(tx.Matter.TrashedBy).Updates(m); err != nil {
			return err
		}
		_, err := tq.Delete(m)
		return err
	})
}

func (db *MatterDBQuery) Recovery(ctx context.Context, id int64) error {
	m, err := db.q.Matter.WithContext(ctx).Unscoped().Where(db.q.Matter.Id.Eq(id)).First()
	if err != nil {
		return err
	}

	if !db.PathExist(ctx, m.Parent) {
		return fmt.Errorf("recovery: file parent[%s] not found", m.Parent)
	}

	_, err = db.q.Matter.WithContext(ctx).Unscoped().Where(db.q.Matter.TrashedBy.Eq(m.TrashedBy)).
		UpdateSimple(db.q.Matter.TrashedBy.Value(""), db.q.Matter.DeletedAt.Null())
	return err
}

func (db *MatterDBQuery) GetObjects(ctx context.Context, id int64) ([]string, error) {
	m, err := db.FindWith(ctx, &MatterFindWithOption{Id: id, Deleted: true})
	if err != nil {
		return nil, err
	}

	if !m.IsDir() {
		return []string{m.Object}, nil
	}

	matters, err := db.findChildren(ctx, m, true)
	if err != nil {
		return nil, err
	}

	return lo.Map(lo.Filter(append(matters, m), func(item *entity.Matter, index int) bool {
		return item.Object != ""
	}), func(item *entity.Matter, index int) string {
		return item.Object
	}), nil
}

func (db *MatterDBQuery) findChildren(ctx context.Context, m *entity.Matter, withDeleted bool) ([]*entity.Matter, error) {
	q := db.q.Matter.WithContext(ctx)
	if withDeleted {
		q = q.Unscoped()
	}

	return q.Where(db.q.Matter.Parent.Like(m.FullPath() + "%")).Find()
}
