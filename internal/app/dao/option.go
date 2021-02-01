package dao

import (
	"log"

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
	if err := gormutil.DB().Find(ret, "name=?", name).Error; err != nil {
		return nil, err
	}

	return ret.Opts, nil
}

func (o *Option) Set(name string, opts model.Opts) error {
	mOpt := &model.Option{Name: name}
	gormutil.DB().First(mOpt, "name=?", name)
	mOpt.Opts = opts
	return gormutil.DB().Save(mOpt).Error
}

func (o *Option) SiteOpts() model.Opts {
	opts, err := o.Get("site")
	if err != nil {
		log.Panicln(err)
	}

	return opts
}

func (o *Option) MailOpts() model.Opts {
	opts, err := o.Get("mail")
	if err != nil {
		log.Panicln(err)
	}

	return opts
}
