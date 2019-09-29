package dao

import (
	"fmt"

	"zpan/model"
)

type DaoOption struct {
	topic string
}

func Option(topic string) *DaoOption {
	return &DaoOption{topic: topic}
}

func (opt *DaoOption) Set(k, v string) (err error) {
	m := &model.Option{Topic: opt.topic, Name: k, Value: v}
	_, err = DB.Insert(m)
	return
}

func (opt *DaoOption) Get(k string) (string, error) {
	m := new(model.Option)
	exist, err := DB.Where("topic = ? and name = ?", opt.topic, k).Get(m)
	if err != nil {
		return "", err
	}

	if !exist {
		return "", fmt.Errorf("option [%s]%s not exist.", opt.topic, k)
	}

	return m.Value, nil
}
