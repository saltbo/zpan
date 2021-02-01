package dao

import (
	"errors"
	"fmt"
	"strings"

	"github.com/saltbo/gopkg/strutil"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/pkg/gormutil"
)

type User struct {
}

func NewUser() *User {
	return &User{}
}

func (u *User) Find(uid int64) (*model.User, error) {
	user := new(model.User)
	if err := gormutil.DB().First(user, uid).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("user not exist")
	}

	gormutil.DB().Model(user).Association("Profile").Find(&user.Profile)
	gormutil.DB().Model(user).Association("Storage").Find(&user.Storage)

	return user, nil
}

func (u *User) FindAll(query *Query) (list []*model.User, total int64, err error) {
	sn := gormutil.DB()
	if len(query.Params) > 0 {
		sn = sn.Where(query.SQL(), query.Params...)
	}
	sn.Count(&total)
	err = sn.Offset(query.Offset).Limit(query.Limit).Preload(clause.Associations).Find(&list).Error
	for _, user := range list {
		user = user.Format()
	}
	return
}

func (u *User) EmailExist(email string) (*model.User, bool) {
	return u.userExist("email", email)
}

func (u *User) UsernameExist(username string) (*model.User, bool) {
	return u.userExist("username", username)
}

func (u *User) TicketExist(ticket string) (*model.User, bool) {
	return u.userExist("ticket", ticket)
}

func (u *User) userExist(k, v string) (*model.User, bool) {
	user := new(model.User)
	if err := gormutil.DB().Where(k+"=?", v).First(user).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		return user, true
	}

	return nil, false
}

func (u *User) Create(user *model.User) (*model.User, error) {
	_, exist := u.EmailExist(user.Email)
	if exist {
		return nil, fmt.Errorf("email already exist")
	}


	user.Profile = model.UserProfile{
		Uid:      user.Id,
		Nickname: user.Email[:strings.Index(user.Email, "@")],
	}
	user.Storage = model.UserStorage{
		Max: model.UserStorageDefaultSize,
	}

	if err := gormutil.DB().Create(user).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (u *User) Activate(uid int64) error {
	user, err := u.Find(uid)
	if err != nil {
		return err
	}

	if err := gormutil.DB().Model(user).Update("status", model.StatusActivated).Error; err != nil {
		return err
	}

	return nil
}

// ResetPassword update the new password
func (u *User) PasswordReset(uid int64, newPwd string) error {
	user, err := u.Find(uid)
	if err != nil {
		return err
	}

	if err := gormutil.DB().Model(user).Update("password", strutil.Md5Hex(newPwd)).Error; err != nil {
		return err
	}
	// record the old password

	return nil
}

func (u *User) Update(user *model.User) error {
	return gormutil.DB().Save(user).Error
}
