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

const JWT_SECRET = "d52W5^bqTDMhEAwj1MK6ss%Rp7edT0#utzteGP!6tZwwAZtVSK367g4jd3g01c@E"

type RoleClaims struct {
	jwt.StandardClaims

	Roles []string `json:"roles"`
}

type UserResource struct {
}

func NewUserResource() Resource {
	return &UserResource{}
}

func (rs *UserResource) Register(router *ginx.Router) {
	router.POST("/users", rs.signUp)
	router.POST("/user/tokens/:uid", rs.signIn)
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

	if p.PwdC != p.PwdR {
		return ginx.Error(fmt.Errorf("Inconsistent password"))
	}

	if _, err := dao.DB.Insert(p); err != nil {
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

	pwdHash := md5.Sum([]byte(p.PwdR))
	if user.Password != hex.EncodeToString(pwdHash[:]) {
		return ginx.Error(fmt.Errorf("invalid password"))
	}

	token, err := rs.buildToken(user.Id, user.Roles)
	if err != nil {
		return ginx.Failed(err)
	}

	ginx.Cookie(c, "token", token)
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
	fmt.Println(rBac)

	return func(c *gin.Context) error {
		//roles, err := r.QueryRoles(c)
		//if err != nil {
		//	r.Unauthorized(c, err)
		//	return
		//}
		//
		//state, err := rbac.IsRequestGranted(c.Request, roles)
		//if err != nil {
		//	r.Failed(c, err)
		//	return
		//}
		//
		//if !state.IsGranted() {
		//	r.Forbidden(c, fmt.Errorf("您没有权限进行此操作，请联系管理员."))
		//	return
		//}
		c.Set("uid", int64(10001))
		return nil
	}
}
