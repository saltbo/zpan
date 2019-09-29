package model

type Option struct {
	Id    int64  `json:"id"`
	Topic string `json:"topic" xorm:"varchar(16) notnull default ''"`
	Name  string `json:"name" xorm:"varchar(32) notnull default ''"`
	Value string `json:"value" xorm:"varchar(64) notnull default ''"`
}
