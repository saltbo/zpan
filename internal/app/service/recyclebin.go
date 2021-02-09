package service

import (
	"fmt"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
)

type RecycleBin struct {
	dMatter     *dao.Matter
	dRecycleBin *dao.RecycleBin

	sStorage *Storage
}

func NewRecycleBin() *RecycleBin {
	return &RecycleBin{
		dMatter:     dao.NewMatter(),
		dRecycleBin: dao.NewRecycleBin(),

		sStorage: NewStorage(),
	}
}

func (rb *RecycleBin) FindAll(uid int64, sid int64, offset int, limit int) (list []model.Recycle, total int64, err error) {
	query := dao.NewQuery()
	query.WithEq("uid", uid)
	query.WithEq("sid", sid)
	query.Offset = offset
	query.Limit = limit
	return rb.dRecycleBin.FindAll(query)
}

func (rb *RecycleBin) Recovery(uid int64, alias string) error {
	m, err := rb.dRecycleBin.Find(uid, alias)
	if err != nil {
		return err
	}

	return rb.dMatter.Recovery(m)
}

func (rb *RecycleBin) Delete(uid int64, alias string) error {
	m, err := rb.dRecycleBin.Find(uid, alias)
	if err != nil {
		return err
	}

	provider, err := rb.sStorage.GetProvider(m.Sid)
	if err != nil {
		return err
	}

	if !m.IsDir() {
		// delete the remote object
		if err := provider.ObjectDelete(m.Object); err != nil {
			return err
		}
	} else {
		// get all files removed to the recycle bin
		children, err := rb.dMatter.UnscopedChildren(m.Uid, alias)
		if err != nil {
			return err
		}

		objects := make([]string, 0, len(children))
		for _, child := range children {
			if child.IsDir() {
				continue
			}

			m.Size += child.Size // calc all the space occupied by the folder
			objects = append(objects, child.Object)
		}

		// delete the remote objects
		if err := provider.ObjectsDelete(objects); err != nil {
			return err
		}
	}

	return rb.dRecycleBin.Release(m.Uid, m.Size, "alias=?", m.Alias)
}

func (rb *RecycleBin) Clean(uid, sid int64) error {
	query := dao.NewQuery()
	query.WithEq("uid", uid)
	query.WithEq("sid", sid)
	rbs, _, err := rb.dRecycleBin.FindAll(query)
	if err != nil {
		return err
	}

	var size int64
	objects := make([]string, 0)
	for _, recycle := range rbs {
		if recycle.Size > 0 {
			size += recycle.Size
			objects = append(objects, recycle.Object)
			continue
		} else if recycle.DirType > model.DirTypeSys {
			children, err := rb.dMatter.UnscopedChildren(recycle.Uid, recycle.Alias)
			if err != nil {
				return err
			}

			for _, child := range children {
				if child.IsDir() {
					continue
				}

				objects = append(objects, child.Object)
				size += child.Size
			}
		}
	}

	if len(objects) == 0 {
		return fmt.Errorf("empty objects")
	}

	provider, err := rb.sStorage.GetProvider(sid)
	if err != nil {
		return err
	}

	//delete the remote object
	if err := provider.ObjectsDelete(objects); err != nil {
		return err
	}

	return rb.dRecycleBin.Release(uid, size, "uid=?", uid)
}
