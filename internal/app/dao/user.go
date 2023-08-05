package dao

import (
	"errors"
	"fmt"
	"strings"

	"github.com/saltbo/gopkg/strutil"
	"github.com/saltbo/zpan/internal/app/entity"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/saltbo/zpan/internal/app/model"
)

type User struct {
}

func NewUser() *User {
	return &User{}
}

func (u *User) Find(uid int64) (*model.User, error) {
	user := new(model.User)
	if err := gdb.First(user, uid).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("user not exist")
	}

	gdb.Model(user).Association("Profile").Find(&user.Profile)
	gdb.Model(user).Association("Storage").Find(&user.Storage)

	return user, nil
}

func (u *User) FindByUsername(username string) (*model.User, error) {
	user := new(model.User)
	if err := gdb.First(user, "username=?", username).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("user not exist")
	} else if err != nil {
		return nil, err
	}

	return user, nil
}

func (u *User) FindAll(query *Query) (list []*model.User, total int64, err error) {
	sn := gdb.Model(&model.User{})
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
	if err := gdb.Where(k+"=?", v).First(user).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		return user, true
	}

	return nil, false
}

func (u *User) Create(user *model.User, storageMax uint64) (*model.User, error) {
	if _, exist := u.EmailExist(user.Email); exist {
		return nil, fmt.Errorf("email already exist")
	}

	user.Profile = model.UserProfile{
		Uid:      user.Id,
		Nickname: user.Email[:strings.Index(user.Email, "@")],
	}
	user.Storage = entity.UserStorage{
		Max: entity.UserStorageDefaultSize,
	}
	if storageMax > 0 {
		user.Storage.Max = storageMax
	}

	if err := gdb.Create(user).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (u *User) Activate(uid int64) error {
	user, err := u.Find(uid)
	if err != nil {
		return err
	}

	if err := gdb.Model(user).Update("status", model.StatusActivated).Error; err != nil {
		return err
	}

	return nil
}

// PasswordReset update the new password
func (u *User) PasswordReset(uid int64, newPwd string) error {
	user, err := u.Find(uid)
	if err != nil {
		return err
	}

	if err := gdb.Model(user).Update("password", strutil.Md5Hex(newPwd)).Error; err != nil {
		return err
	}
	// record the old password

	return nil
}

func (u *User) Update(user *model.User) error {
	return gdb.Save(user).Error
}

func (u *User) UpdateStatus(uid int64, status uint8) error {
	return gdb.Model(model.User{}).Where("id=?", uid).Update("status", status).Error
}

func (u *User) Delete(user *model.User) error {
	return gdb.Delete(user).Error
}

func (u *User) UpdateProfile(uid int64, up *model.UserProfile) error {
	return gdb.Model(model.UserProfile{}).Where("uid=?", uid).Updates(up).Error
}

func (u *User) UpdateStorage(uid int64, quota uint64) error {
	return gdb.Model(entity.UserStorage{}).Where("uid=?", uid).Update("max", quota).Error
}
