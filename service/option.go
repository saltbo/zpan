package service

import (
	"fmt"

	"github.com/saltbo/gopkg/gormutil"

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

	opts := make(map[string]interface{})
	for _, opt := range ret.Opts {
		opts[opt.Key] = opt.Val
	}
	return opts, nil
}

func (o *Option) Save(name string, opts map[string]interface{}) error {
	iopts := make([]model.Opt, 0)
	for k, v := range opts {
		iopts = append(iopts, model.Opt{Key: k, Val: fmt.Sprintf("%v", v)})
	}
	opt := &model.Option{Name: name, Opts: iopts}
	return gormutil.DB().Save(opt).Error
}
