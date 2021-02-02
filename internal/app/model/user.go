package model

import (
	"strconv"
	"strings"
	"time"
)

const (
	RoleAdmin  = "admin"
	RoleMember = "member"
	RoleGuest  = "guest"
)

const (
	StatusInactivated = iota
	StatusActivated
	StatusDisabled
)

var roles = map[string]string{
	RoleAdmin:  "管理员",
	RoleMember: "注册用户",
	RoleGuest:  "游客",
}

var status = map[uint8]string{
	StatusInactivated: "未激活",
	StatusActivated:   "已激活",
	StatusDisabled:    "已禁用",
}

type UserCreateOption struct {
	Roles     string
	Ticket    string
	Origin    string
	Activated bool
}

func NewUserCreateOption() UserCreateOption {
	return UserCreateOption{}
}

type User struct {
	Id        int64       `json:"id"`
	Email     string      `json:"email" gorm:"size:32;unique_index;not null"`
	Username  string      `json:"username" gorm:"size:20;unique_index;not null"`
	Password  string      `json:"-" gorm:"size:32;not null"`
	Status    uint8       `json:"-" gorm:"size:1;not null"`
	StatusTxt string      `json:"status" gorm:"-"`
	Roles     string      `json:"-" gorm:"size:64;not null"`
	RoleTxt   string      `json:"role" gorm:"-"`
	Ticket    string      `json:"ticket" gorm:"size:6;unique_index;not null"`
	Profile   UserProfile `json:"profile,omitempty" gorm:"foreignKey:Uid"`
	Storage   UserStorage `json:"storage,omitempty" gorm:"foreignKey:Uid"`
	Deleted   *time.Time  `json:"-" gorm:"column:deleted_at"`
	Created   time.Time   `json:"created" gorm:"column:created_at;not null"`
	Updated   time.Time   `json:"updated" gorm:"column:updated_at;not null"`

	Token string `json:"-" gorm:"-"`
}

func (User) TableName() string {
	return "mu_user"
}

func (u *User) IDString() string {
	return strconv.FormatInt(u.Id, 10)
}

func (u *User) Activated() bool {
	return u.Status == StatusActivated
}

func (u *User) RolesSplit() []string {
	return strings.Split(u.Roles, ",")
}

func (u *User) Format() *User {
	u.RoleTxt = roles[u.Roles]
	u.StatusTxt = status[u.Status]
	return u
}
