package model

import (
	"fmt"
	"strings"
	"time"

	"github.com/saltbo/gopkg/strutil"
	"gorm.io/gorm"
)

const ()

type UserKey struct {
	Id        int64          `json:"id"`
	Uid       int64          `json:"uid" gorm:"not null"`
	Name      string         `json:"name" gorm:"not null"`
	AccessKey string         `json:"access_key" gorm:"size:32;not null"`
	SecretKey string         `json:"secret_key" gorm:"size:64;not null"`
	Created   time.Time      `json:"created" gorm:"autoCreateTime;not null"`
	Updated   time.Time      `json:"updated" gorm:"autoUpdateTime;not null"`
	Deleted   gorm.DeletedAt `json:"-"`
}

func NewUserKey(uid int64, name string) *UserKey {
	uk := &UserKey{
		Uid:       uid,
		Name:      name,
		AccessKey: strutil.Md5Hex(fmt.Sprintf("%d:%d:%s", uid, time.Now().Unix(), strutil.RandomText(5))),
	}
	uk.ResetSecret()
	return uk
}

func (UserKey) TableName() string {
	return "zp_user_key"
}

func (uk *UserKey) ResetSecret() {
	l := strutil.Md5HexShort(strutil.RandomText(8))
	r := strutil.Md5HexShort(strutil.RandomText(8))
	m := strutil.Md5HexShort(l + uk.AccessKey + r)
	uk.SecretKey = strings.ToLower(l + m + r)
}
