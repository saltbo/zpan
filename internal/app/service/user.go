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
	dOpt  *dao.Option

	sToken *Token
	sMail  *Mail
}

func NewUser() *User {
	return &User{
		dUser: dao.NewUser(),
		dOpt:  dao.NewOption(),

		sToken: NewToken(),
		sMail:  NewMail(),
	}
}

func (u *User) Signup(email, password string, opt model.UserCreateOption) (*model.User, error) {
	if _, exist := u.dUser.TicketExist(opt.Ticket); !exist && opt.Ticket != "" {
		return nil, fmt.Errorf("invalid ticket")
	}

	// 创建基本信息
	user := &model.User{
		Email:    email,
		Username: fmt.Sprintf("mu%s", strutil.RandomText(18)),
		Password: strutil.Md5Hex(password),
		Roles:    opt.Roles,
		Ticket:   strutil.RandomText(6),
	}
	mUser, err := u.dUser.Create(user, opt.StorageMax)
	if err != nil {
		return nil, err
	}

	// 如果如果启用了发信邮箱则发送一份激活邮件给用户
	if u.sMail.Enabled() {
		token, err := u.sToken.Create(user.IDString(), 3600*24, user.Roles)
		if err != nil {
			return nil, err
		}

		return mUser, u.sMail.NotifyActive(opt.Origin, email, token)
	}

	return mUser, nil
}

func (u *User) Active(token string) error {
	rc, err := u.sToken.Verify(token)
	if err != nil {
		return err
	}

	uid, _ := strconv.ParseInt(rc.Subject, 10, 64)
	user, err := u.dUser.Find(uid)
	if err != nil {
		return err
	} else if user.Status >= model.StatusActivated {
		return fmt.Errorf("account already activated")
	}

	u.dUser.UpdateStorage(uid, model.UserStorageActiveSize) // 激活即送1G空间
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
	} else if u.sMail.Enabled() && !user.Activated() {
		return nil, fmt.Errorf("account is not activated")
	}

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

	return u.sMail.NotifyPasswordReset(origin, email, token)
}

func (u *User) PasswordReset(token, password string) error {
	rc, err := u.sToken.Verify(token)
	if err != nil {
		return err
	}

	return u.dUser.PasswordReset(rc.Uid(), password)
}

func (u *User) InviteRequired() bool {
	opts, err := u.dOpt.Get(model.OptSite)
	if err != nil {
		return false
	}

	return opts.GetBool("invite_required")
}
