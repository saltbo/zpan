package service

import (
	"fmt"
	"strconv"

	"github.com/saltbo/gopkg/regexputil"
	"github.com/saltbo/gopkg/strutil"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
)

type User struct {
	dUser *dao.User

	sToken *Token
	sMail  *Mail
}

func NewUser() *User {
	return &User{
		dUser: dao.NewUser(),

		sToken: NewToken(),
		sMail:  NewMail(),
	}
}

func (u *User) Signup(email, password string, opt model.UserCreateOption) (*model.User, error) {
	// 创建基本信息
	user := &model.User{
		Email:    email,
		Username: fmt.Sprintf("mu%s", strutil.RandomText(18)),
		Password: strutil.Md5Hex(password),
		Roles:    opt.Roles,
		Ticket:   strutil.RandomText(6),
	}
	if opt.Activated {
		user.Status = model.StatusActivated
	}

	if mUser, err := u.dUser.Create(user, opt.StorageMax); err != nil {
		return mUser, err
	}

	token, err := u.sToken.Create(user.IDString(), 3600*24, user.Roles)
	if err != nil {
		return nil, err
	}

	return nil, u.sMail.SendSignupSuccessNotify(email, token)
}

func (u *User) Active(token string) error {
	rc, err := u.sToken.Verify(token)
	if err != nil {
		return err
	}

	uid, _ := strconv.ParseInt(rc.Subject, 10, 64)
	return u.dUser.Activate(uid)
}

func (u *User) SignIn(usernameOrEmail, password string, ttl int) (*model.User, error) {
	userFinder := u.dUser.UsernameExist
	if regexputil.EmailRegex.MatchString(usernameOrEmail) {
		userFinder = u.dUser.EmailExist
	}

	user, exist := userFinder(usernameOrEmail)
	if !exist {
		return nil, fmt.Errorf("user not exist")
	} else if user.Password != strutil.Md5Hex(password) {
		return nil, fmt.Errorf("invalid password")
	}
	//if system.EmailActed() && !user.Activated() {
	//	return nil, fmt.Errorf("account is not activated")
	//}

	token, err := u.sToken.Create(user.IDString(), ttl, user.Roles)
	if err != nil {
		return nil, err
	}
	user.Token = token
	return user, nil
}

func (u *User) SignOut() {

}

func (u *User) PasswordUpdate(uid int64, oldPwd, newPwd string) error {
	user, err := u.dUser.Find(uid)
	if err != nil {
		return err
	} else if user.Password != strutil.Md5Hex(oldPwd) {
		return fmt.Errorf("error password")
	}

	user.Password = strutil.Md5Hex(newPwd)
	return u.dUser.Update(user)
}

func (u *User) PasswordResetApply(origin, email string) error {
	user, ok := u.dUser.EmailExist(email)
	if !ok {
		return fmt.Errorf("email not exist")
	}

	// issue a short-term token for password reset
	token, err := u.sToken.Create(user.IDString(), 300)
	if err != nil {
		return err
	}

	return u.sMail.SendPasswordResetNotify(email, token)
}

func (u *User) PasswordReset(token, password string) error {
	rc, err := u.sToken.Verify(token)
	if err != nil {
		return err
	}

	return u.dUser.PasswordReset(rc.Uid(), password)
}
