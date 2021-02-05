package dao

import (
	"github.com/saltbo/zpan/internal/pkg/gormutil"

	"github.com/saltbo/zpan/internal/app/model"
)

type Option struct {
}

func NewOption() *Option {
	return &Option{}
}

func (o *Option) Get(name string) (model.Opts, error) {
	ret := new(model.Option)
	if err := gormutil.DB().First(ret, "name=?", name).Error; err != nil {
		return nil, err
	}

	return ret.Opts, nil
}

func (o *Option) Set(name string, opts model.Opts) error {
	mOpt := &model.Option{Name: name}
	gormutil.DB().First(mOpt, "name=?", name)
	if opts != nil {
		mOpt.Opts = opts
	}
	return gormutil.DB().Save(mOpt).Error
}
