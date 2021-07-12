package service

import (
	"context"
	"encoding/base64"
	"log"
	"strings"

	"github.com/go-oauth2/oauth2/v4"
	"github.com/go-oauth2/oauth2/v4/models"
	"github.com/go-oauth2/oauth2/v4/store"
	"github.com/google/uuid"
	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/spf13/viper"
)

var cs = store.NewClientStore()

type UserKey struct {
	dUserKey *dao.UserKey

	sToken *Token
}

func NewUserKey() *UserKey {
	return &UserKey{
		dUserKey: dao.NewUserKey(),

		sToken: NewToken(),
	}
}

func (uk *UserKey) Token(ctx context.Context, data *oauth2.GenerateBasic, isGenRefresh bool) (access, refresh string, err error) {
	muk, err := uk.dUserKey.FindByClientID(data.Client.GetID())
	if err != nil {
		return "", "", err
	}

	user, err := dao.NewUser().Find(muk.Uid)
	if err != nil {
		return "", "", err
	}

	ttl := data.TokenInfo.GetAccessCreateAt().Add(data.TokenInfo.GetAccessExpiresIn()).Unix()
	access, err = uk.sToken.Create(user.IDString(), int(ttl), user.Roles)
	if err != nil {
		return
	}

	if isGenRefresh {
		t := uuid.NewSHA1(uuid.Must(uuid.NewRandom()), []byte(access)).String()
		refresh = base64.URLEncoding.EncodeToString([]byte(t))
		refresh = strings.ToUpper(strings.TrimRight(refresh, "="))
	}
	return
}

func (uk *UserKey) ClientStore() *store.ClientStore {
	return cs
}

func (uk *UserKey) Create(muk *model.UserKey) error {
	if _, err := uk.dUserKey.Create(muk); err != nil {
		return err
	}

	return uk.ClientStore().Set(muk.AccessKey, &models.Client{ID: muk.AccessKey, Secret: muk.SecretKey})
}

func (uk *UserKey) ResetSecret(muk *model.UserKey) error {
	muk.ResetSecret()
	if err := uk.dUserKey.Update(muk); err != nil {
		return err
	}

	return uk.ClientStore().Set(muk.AccessKey, &models.Client{ID: muk.AccessKey, Secret: muk.SecretKey})
}

func (uk *UserKey) LoadExistClient() {
	if !viper.IsSet("installed") {
		return
	}

	list, _, err := uk.dUserKey.FindAll(dao.NewQuery())
	if err != nil {
		log.Println(err)
		return
	}

	for _, muk := range list {
		cli := &models.Client{ID: muk.AccessKey, Secret: muk.SecretKey}
		if err := uk.ClientStore().Set(muk.AccessKey, cli); err != nil {
			log.Println(err)
		}
	}
}
