package service

import (
	"log"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
)

type BootFunc func(opts model.Opts) error

var optBoots = map[string]BootFunc{}

func OptRegister(name string, bf BootFunc) {
	optBoots[name] = bf

	dOpt := dao.NewOption()
	opts, err := dOpt.Get(name)
	if err != nil {
		dOpt.Set(name, map[string]interface{}{})
		return
	}

	// 检查boot参数是否存在
	// 如果不存在则直接跳过
	if len(opts) == 0 {
		log.Printf("WARN: skip boot for the component %s", name)
		return
	}

	// 如果存在则执行一次BootFunc
	if err := bf(opts); err != nil {
		log.Printf("ERR: opt-%s boot failed: %s\n", name, err)
		return
	}
}

type Option struct {
	dOption *dao.Option
}

func NewOption() *Option {
	return &Option{
		dOption: dao.NewOption(),
	}
}

func (o *Option) Update(name string, p model.Opts) error {
	if err := o.dOption.Set(name, p); err != nil {
		return err
	}

	if boot, ok := optBoots[name]; ok {
		return boot(p)
	}

	return nil
}
