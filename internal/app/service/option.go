package service

import (
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/logger"
)

type BootFunc func(opts model.Opts) error

var optBoots = map[string]BootFunc{}

func OptRegister(name string, bf BootFunc) {
	optBoots[name] = bf
	if !dao.Ready() {
		return // 如果数据库还没装好则先跳过
	}

	dOpt := dao.NewOption()
	opts, err := dOpt.Get(name)
	if err != nil {
		dOpt.Set(name, map[string]interface{}{})
		return
	}

	// 检查boot参数是否存在
	// 如果不存在则直接跳过
	if len(opts) == 0 {
		logger.Warn("skip boot for the component", "component", name)
		return
	}

	// 如果存在则执行一次BootFunc
	if err := bf(opts); err != nil {
		logger.Error("opt boot failed", "component", name, "error", err)
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
	if boot, ok := optBoots[name]; ok {
		if err := boot(p); err != nil {
			return err
		}
	}

	return o.dOption.Set(name, p)
}
