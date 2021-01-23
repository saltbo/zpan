package dao

import (
	"github.com/saltbo/zpan/pkg/gormutil"

	"github.com/saltbo/zpan/model"
)

type Option struct {
}

func NewOption() *Option {
	return &Option{}
}

func (o *Option) Get(name string) (map[string]interface{}, error) {
	ret := new(model.Option)
	if err := gormutil.DB().Find(ret, "name=?", name).Error; err != nil {
		return nil, err
	}

	return ret.Opts, nil
}

func (o *Option) Save(name string, opts map[string]interface{}) error {
	mOpt := &model.Option{Name: name}
	gormutil.DB().First(mOpt, "name=?", name)
	mOpt.Opts = opts
	return gormutil.DB().Save(mOpt).Error
}
