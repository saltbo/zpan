package api

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
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
}

func NewUserResource() Resource {
	return &UserResource{
		jwtSecret: []byte(JWT_SECRET),
	}
}

func (rs *UserResource) Register(router *ginx.Router) {
	router.POST("/users", rs.signUp)
	router.POST("/user/tokens", rs.signIn)
	router.Use(rs.Auth())

	router.GET("/users", rs.findAll)
	router.PATCH("/user/tokens/:uid", rs.signOut)
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

func (rs *UserResource) signUp(c *gin.Context) error {
	p := new(BodyUser)
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
		Email:      p.Email,
		Password:   hex.EncodeToString(pwdHash[:]),
		Nickname:   p.Email[:strings.Index(p.Email, "@")],
		StorageMax: 1024 * 1024 * 50, // 50MB
		Roles:      ROLE_MEMBER,
	}
	if _, err := dao.DB.Insert(m); err != nil {
		return ginx.Failed(err)
	}

	return nil
}

func (rs *UserResource) signIn(c *gin.Context) error {
	p := new(BodyUser)
	if err := c.ShouldBindJSON(p); err != nil {
		return ginx.Error(err)
	}

	user := new(model.User)
	if exist, err := dao.DB.Where("email = ?", p.Email).Get(user); err != nil {
		return ginx.Failed(err)
	} else if !exist {
		return ginx.Error(fmt.Errorf("user %s not exist.", p.Email))
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
	ginx.Cookie(c, "nickname", user.Nickname)
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
