package service

import (
	"context"

	"github.com/antihax/optional"
	"github.com/jinzhu/gorm"
	"github.com/saltbo/gopkg/gormutil"
	"github.com/saltbo/moreu/client"

	"github.com/saltbo/zpan/model"
	"github.com/saltbo/zpan/service/matter"
)

const defaultSize = 50 << 20

type User struct {
	iss uint64
}

func NewUser(iss uint64) *User {
	if iss == 0 {
		iss = defaultSize
	}

	return &User{iss: iss}
}

func (u *User) Create(ux string) (*model.User, error) {
	user := &model.User{
		Ux:         ux,
		StorageMax: u.iss,
	}

	fc := func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}

		return matter.Init(tx, user.Id, ".pics")
	}

	return user, gormutil.DB().Transaction(fc)
}

func (u *User) Find(ux string) (*model.User, error) {
	user := new(model.User)
	if gormutil.DB().First(user, "ux=?", ux).RecordNotFound() {
		return u.Create(ux)
	}

	return user, nil
}

func (u *User) FindAll(cookie, email string, offset, limit int) (formats []model.UserFormats, total int64, err error) {
	opts := &client.UsersApiUsersGetOpts{
		Email:  optional.NewString(email),
		Offset: optional.NewInt32(int32(offset)),
		Limit:  optional.NewInt32(int32(limit)),
	}

	cfg := client.NewConfiguration()
	cfg.AddDefaultHeader("Cookie", cookie)
	cli := client.NewAPIClient(cfg)
	cli.ChangeBasePath("http://localhost:8222/api/moreu")
	ret, _, err := cli.UsersApi.UsersGet(context.Background(), opts)
	if err != nil {
		return nil, 0, err
	}

	total = int64(ret.Data.Total)
	uxs := make([]string, 0, total)
	for _, user := range ret.Data.List {
		uxs = append(uxs, user.Ux)
	}

	list := make([]model.User, 0)
	sn := gormutil.DB().Debug().Where("ux in (?)", uxs)
	if err = sn.Find(&list).Error; err != nil {
		return nil, 0, err
	}

	for idx, user := range ret.Data.List {
		uf := model.UserFormats{
			User:     list[idx],
			Email:    user.Email,
			Username: user.Username,
			RoleName: user.Role,
			Status:   user.Status,
			Avatar:   user.Avatar,
			Nickname: user.Nickname,
			Bio:      user.Bio,
		}

		formats = append(formats, uf)
	}
	return
}

//7wABQLCA
func (u *User) StoragePatch(id int64, max uint64) error {
	return gormutil.DB().Model(&model.User{Id: id}).Update("storage_max", max).Error
}
