package dao

import (
	"github.com/saltbo/zpan/internal/app/model"
)

type Option struct {
}

func NewOption() *Option {
	return &Option{}
}

func (o *Option) Get(name string) (model.Opts, error) {
	ret := new(model.Option)
	if err := gdb.First(ret, "name=?", name).Error; err != nil {
		return nil, err
	}

	return ret.Opts, nil
}

func (o *Option) Set(name string, opts model.Opts) error {
	mOpt := &model.Option{Name: name}
	gdb.First(mOpt, "name=?", name)
	if opts != nil {
		mOpt.Opts = opts
	}
	return gdb.Save(mOpt).Error
}

func (o *Option) Init() error {
	o.Set(model.OptSite, model.DefaultSiteOpts)
	o.Set(model.OptEmail, model.DefaultEmailOpts)
	return nil
}
