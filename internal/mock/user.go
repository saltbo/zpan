package mock

import (
	"context"

	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
)

var _ repo.User = (*User)(nil)

type User struct {
}

func NewUser() *User {
	return &User{}
}

func (u *User) GetUserStorage(ctx context.Context, uid int64) (*entity.UserStorage, error) {
	return &entity.UserStorage{Uid: uid, Max: 1000, Used: 10}, nil
}

func (u *User) UserStorageUsedIncr(ctx context.Context, matter *entity.Matter) error {
	return nil
}

func (u *User) UserStorageUsedDecr(ctx context.Context, matter *entity.Matter) error {
	return nil
}
