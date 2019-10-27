package api

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/gin-gonic/gin"
	"github.com/storyicon/grbac"

	"zpan/dao"
	"zpan/model"
	"zpan/pkg/ginx"
)

const (
	IN_TOKEN   = "intoken"
	JWT_SECRET = "d52W5^bqTDMhEAwj1MK6ss%Rp7edT0#utzteGP!6tZwwAZtVSK367g4jd3g01c@E"

	ROLE_ADMIN     = "admin"
	ROLE_MEMBER    = "member"
	ROLE_ANONYMOUS = "anonymous"
)

type RoleClaims struct {
	jwt.StandardClaims

	Uid   int64    `json:"uid"`
	Roles []string `json:"roles"`
}

type UserResource struct {
	jwtSecret []byte
	siteHost  string
	mailHost  string
	mailUser  string
	mailPwd   string
}

func NewUserResource(rs *RestServer) Resource {
	return &UserResource{
		jwtSecret: []byte(JWT_SECRET),
		siteHost:  rs.conf.SiteHost,
		mailHost:  rs.conf.Email.Host,
		mailUser:  rs.conf.Email.User,
		mailPwd:   rs.conf.Email.Password,
	}
}

func (rs *UserResource) Register(router *ginx.Router) {
	router.POST("/users", rs.signUp)
	router.POST("/user/tokens", rs.signIn)
	router.PATCH("/user/resources", rs.activate)
	router.POST("/user/recover-tokens", rs.sendRecoverMail)
	router.PATCH("/user/password", rs.resetPassword)
	router.Use(rs.Auth())

	router.GET("/users", rs.findAll)
	router.GET("/users/:uid", rs.find)
}

func (rs *UserResource) findAll(c *gin.Context) error {
	p := new(QueryUser)
	if err := c.BindQuery(p); err != nil {
		return ginx.Error(err)
	}

	list := make([]model.User, 0)
	total, err := dao.DB.Limit(p.Limit, p.Offset).FindAndCount(&list)
	if err != nil {
		return ginx.Error(err)
	}

	return ginx.JsonList(c, list, total)
}

func (rs *UserResource) find(c *gin.Context) error {
	userId := c.Param("uid")

	user := new(model.User)
	if _, err := dao.DB.Id(userId).Get(user); err != nil {
		return ginx.Error(err)
	}
	user.Password = ""

	return ginx.Json(c, user)
}

func (rs *UserResource) signUp(c *gin.Context) error {
	p := new(BodySignup)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Where("email = ?", p.Email).Get(user); err != nil {
		return ginx.Failed(err)
	} else if exist {
		return ginx.Error(fmt.Errorf("user %s exist.", p.Email))
	}

	pwdHash := md5.Sum([]byte(p.Password))
	m := &model.User{
		Email:       p.Email,
		Password:    hex.EncodeToString(pwdHash[:]),
		Nickname:    p.Email[:strings.Index(p.Email, "@")],
		StorageMax:  1024 * 1024 * 50, // 50MB
		Roles:       ROLE_MEMBER,
		ActiveToken: randomString(64),
	}
	if _, err := dao.DB.Insert(m); err != nil {
		return ginx.Failed(err)
	}

	body := `
        <h3>账户激活链接</h3>
        <p><a href="%s/login?email=%s&atoken=%s">点击此处重置密码</a></p>
		<p>如果您没有进行账号注册请忽略！</p>
        `
	body = fmt.Sprintf(body, rs.siteHost, p.Email, m.ActiveToken)
	if err := rs.sendMail("账号注册成功，请激活您的账户", body, p.Email); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func (rs *UserResource) activate(c *gin.Context) error {
	p := new(BodyActivate)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Where("email = ?", p.Email).Get(user); err != nil {
		return ginx.Failed(err)
	} else if !exist || user.ActiveToken != p.Atoken {
		return ginx.Error(fmt.Errorf("invalid activate token."))
	}

	session := dao.DB.NewSession()
	defer session.Close()

	// 初始化系统资源
	picFolder := model.Matter{Uid: user.Id, Name: ".pics", Dirtype: DIRTYPE_SYS}
	if _, err := session.Insert(picFolder); err != nil {
		_ = session.Rollback()
		return ginx.Failed(err)
	}

	// 标记激活成功
	if _, err := session.ID(user.Id).Cols("active_token").Update(&model.User{ActiveToken: ""}); err != nil {
		_ = session.Rollback()
		return ginx.Failed(fmt.Errorf("active failed: %s", err))
	}

	if err := session.Commit(); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func (rs *UserResource) signIn(c *gin.Context) error {
	p := new(BodySignin)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Where("email = ?", p.Email).Get(user); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("user %s not exist.", p.Email))
	} else if user.ActiveToken != "" {
		return ginx.Error(fmt.Errorf("email not activated!"))
	}

	pwdHash := md5.Sum([]byte(p.Password))
	if user.Password != hex.EncodeToString(pwdHash[:]) {
		return ginx.Error(fmt.Errorf("invalid password"))
	}

	token, err := rs.buildToken(user.Id, user.Roles)
	if err != nil {
		return ginx.Failed(err)
	}

	ginx.Cookie(c, IN_TOKEN, token)
	ginx.Cookie(c, "uid", fmt.Sprint(user.Id))
	return nil
}

func (rs *UserResource) signOut(c *gin.Context) error {
	return nil
}

func (r *UserResource) buildToken(userId int64, userRole string) (token string, err error) {
	timeNow := time.Now()
	claims := &RoleClaims{
		StandardClaims: jwt.StandardClaims{
			Issuer:    "ZPan",
			Audience:  "ZPanAPI",
			ExpiresAt: timeNow.Add(7 * 24 * 3600 * time.Second).Unix(),
			IssuedAt:  timeNow.Unix(),
			NotBefore: timeNow.Unix(),
			Subject:   fmt.Sprint(userId),
		},
		Uid:   userId,
		Roles: strings.Split(userRole, ","),
	}
	token, err = jwt.NewWithClaims(jwt.SigningMethodHS512, claims).SignedString([]byte(JWT_SECRET))
	return
}

func (r *UserResource) Auth() ginx.HandlerFunc {
	rBac, err := grbac.New(grbac.WithJSON("roles.json", time.Minute*10))
	if err != nil {
		panic(err)
	}

	return func(c *gin.Context) error {
		roles, err := r.queryRoles(c)
		if err != nil {
			roles = []string{ROLE_ANONYMOUS}
		}

		state, err := rBac.IsRequestGranted(c.Request, roles)
		if err != nil {
			return ginx.Failed(err)
		}

		if !state.IsGranted() {
			return ginx.Forbidden(fmt.Errorf("您没有权限进行此操作，请联系管理员."))
		}

		return nil
	}
}

func (r *UserResource) queryRoles(c *gin.Context) ([]string, error) {
	jwtToken, err := c.Cookie(IN_TOKEN)
	if err != nil {
		return nil, err
	}

	validation := func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("Unexpected signing method: %v", token.Header["alg"])
		}

		return r.jwtSecret, nil
	}
	token, err := jwt.ParseWithClaims(jwtToken, &RoleClaims{}, validation)
	if err != nil {
		return nil, fmt.Errorf("token valid failed: %s", err)
	}

	rc := token.Claims.(*RoleClaims)
	c.Set("uid", rc.Uid)
	fmt.Println(rc.Uid)
	return rc.Roles, nil
}

func (rs *UserResource) sendRecoverMail(c *gin.Context) error {
	p := new(BodySendRecoverMail)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Where("email = ?", p.Email).Get(user); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("user %s not exist.", p.Email))
	}

	// 记录恢复令牌
	u := &model.User{RecoverToken: randomString(64)}
	if _, err := dao.DB.ID(user.Id).Cols("recover_token").Update(u); err != nil {
		return ginx.Failed(fmt.Errorf("active failed: %s", err))
	}

	body := `
        <h3>密码重置链接</h3>
        <p><a href="%s/login/resetpwd?email=%s&rtoken=%s">点击此处重置密码</a></p>
		<p>如果您没有申请重置密码请忽略！</p>
        `
	body = fmt.Sprintf(body, rs.siteHost, p.Email, u.RecoverToken)
	if err := rs.sendMail("密码重置申请", body, p.Email); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func (rs *UserResource) resetPassword(c *gin.Context) error {
	p := new(BodyResetPassword)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Where("email = ?", p.Email).Get(user); err != nil {
		return ginx.Failed(err)
	} else if !exist || user.RecoverToken != p.Rtoken {
		return ginx.Error(fmt.Errorf("invalid recover token."))
	}

	// update the new password
	pwdHash := md5.Sum([]byte(p.Password))
	u := &model.User{Password: hex.EncodeToString(pwdHash[:]), RecoverToken: ""}
	if _, err := dao.DB.ID(user.Id).Cols("password", "recover_token").Update(u); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func (rs *UserResource) sendMail(subject, body, to string) error {
	host, _, err := net.SplitHostPort(rs.mailHost)
	if err != nil {
		return err
	}

	auth := smtp.PlainAuth("", rs.mailUser, rs.mailPwd, host)
	contentType := "Content-Type: text/html; charset=UTF-8"
	msg := []byte("To: " + to + "\r\nFrom: " + rs.mailUser + "\r\nSubject: " + subject + "\r\n" + contentType + "\r\n\r\n" + body)
	return smtp.SendMail(rs.mailHost, auth, rs.mailUser, []string{to}, msg)
}
