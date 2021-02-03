package api

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"
	_ "github.com/saltbo/gopkg/httputil"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/app/model"
	"github.com/saltbo/zpan/internal/app/service"
	"github.com/saltbo/zpan/internal/pkg/authed"
	"github.com/saltbo/zpan/internal/pkg/bind"
	"github.com/saltbo/zpan/internal/pkg/middleware"
)

type UserResource struct {
	dUser *dao.User
	sUser *service.User
}

func NewUserResource() *UserResource {
	return &UserResource{
		dUser: dao.NewUser(),
		sUser: service.NewUser(),
	}
}

func (rs *UserResource) Register(router *gin.RouterGroup) {
	router.POST("/users", rs.create)        // 账户注册
	router.PATCH("/users/:email", rs.patch) // 账户激活、密码重置

	router.Use(middleware.LoginAuth())
	router.GET("/users", rs.findAll)                           // 查询用户列表，需管理员权限
	router.GET("/users/:username", rs.find)                    // 查询某一个用户的公开信息
	router.PUT("/users/:username/storage", rs.updateStorage)   // 修改某一个用户的存储空间
	router.PUT("/users/:username/password", rs.updatePassword) // 修改某一个用户的用户密码

	router.GET("/user", rs.userMe)                  // 获取已登录用户的所有信息
	router.PUT("/user/profile", rs.updateProfile)   // 更新已登录用户个人信息
	router.PUT("/user/password", rs.updatePassword) // 修改已登录用户密码
}

// findAll godoc
// @Tags v1/Users
// @Summary 用户列表
// @Description 获取用户列表信息
// @Accept json
// @Produce json
// @Param query query bind.QueryUser true "参数"
// @Success 200 {object} httputil.JSONResponse{data=gin.H{list=[]model.UserFormats,total=int64}}
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/users [get]
func (rs *UserResource) findAll(c *gin.Context) {
	p := new(bind.QueryUser)
	if err := c.BindQuery(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	query := dao.NewQuery()
	query.WithPage(p.PageNo, p.PageSize)
	if p.Email != "" {
		query.WithLike("email", p.Email)
	}

	list, total, err := rs.dUser.FindAll(query)
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONList(c, list, total)
}

// find godoc
// @Tags v1/Users
// @Summary 用户查询
// @Description 获取一个用户的公开信息
// @Accept json
// @Produce json
// @Param username path string true "用户名"
// @Success 200 {object} httputil.JSONResponse{data=model.UserProfile}
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/users/{username} [get]
func (rs *UserResource) find(c *gin.Context) {
	user, exist := rs.dUser.UsernameExist(c.Param("username"))
	if !exist {
		ginutil.JSONServerError(c, fmt.Errorf("user not exist"))
		return
	}

	ginutil.JSONData(c, user.Profile)
}

// updateStorage godoc
// @Tags v1/Users
// @Summary 修改登录用户存储空间
// @Description 修改登录用户存储空间
// @Accept json
// @Produce json
// @Param username path string true "用户名"
// @Param body body bind.BodyUserPassword true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/users/{username}/storage [put]
func (rs *UserResource) updateStorage(c *gin.Context) {
	p := new(bind.BodyUserStorage)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	user, err := rs.dUser.FindByUsername(c.Param("username"))
	if err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	if err := rs.dUser.UpdateStorage(user.Id, p.Max); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

// create godoc
// @Tags v1/Users
// @Summary 用户注册
// @Description 注册一个用户
// @Accept json
// @Produce json
// @Param body body bind.BodyUser true "参数"
// @Success 200 {object} httputil.JSONResponse{data=model.User}
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/users [post]
func (rs *UserResource) create(c *gin.Context) {
	p := new(bind.BodyUserCreation)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	//if system.InvitationOnly() && p.Ticket == "" {
	//	ginutil.JSONBadRequest(c, fmt.Errorf("ticket required"))
	//	return
	//}

	opt := model.NewUserCreateOption()
	opt.Roles = model.RoleMember
	opt.Ticket = p.Ticket
	if authed.IsAdmin(c) {
		opt.Roles = p.Roles
		opt.StorageMax = p.StorageMax
	}

	opt.Origin = ginutil.GetOrigin(c)
	if _, err := rs.sUser.Signup(p.Email, p.Password, opt); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	ginutil.JSON(c)
}

// patch godoc
// @Tags v1/Users
// @Summary 更新一项用户信息
// @Description 用于账户激活和密码重置
// @Accept json
// @Produce json
// @Param email path string true "邮箱"
// @Param body body bind.BodyUserPatch true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/users/{email} [patch]
func (rs *UserResource) patch(c *gin.Context) {
	p := new(bind.BodyUserPatch)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	// account activate
	if p.Activated {
		if err := rs.sUser.Active(p.Token); err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
	}

	// password reset
	if p.Password != "" {
		if err := rs.sUser.PasswordReset(p.Token, p.Password); err != nil {
			ginutil.JSONServerError(c, err)
			return
		}
	}

	ginutil.JSON(c)
}

// profile godoc
// @Tags v1/Users
// @Summary 当前登录用户信息
// @Description 获取已登录用户的详细信息
// @Accept json
// @Produce json
// @Success 200 {object} httputil.JSONResponse{data=gin.H{user=model.User,profile=model.UserProfile}}
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/user [get]
func (rs *UserResource) userMe(c *gin.Context) {
	user, err := rs.dUser.Find(authed.UidGet(c))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSONData(c, user)
}

// updatePassword godoc
// @Tags v1/Users
// @Summary 修改登录用户密码
// @Description 修改登录用户密码
// @Accept json
// @Produce json
// @Param body body bind.BodyUserPassword true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/users/{username}/password [put]
// @Router /v1/user/password [put]
func (rs *UserResource) updatePassword(c *gin.Context) {
	p := new(bind.BodyUserPassword)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	uid := authed.UidGet(c)
	if username := c.Param("username"); username != "" {
		user, err := rs.dUser.FindByUsername(username)
		if err != nil {
			ginutil.JSONBadRequest(c, err)
			return
		}

		uid = user.Id
	}

	if err := rs.sUser.PasswordUpdate(uid, p.OldPassword, p.NewPassword); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}

// updateProfile godoc
// @Tags v1/Users
// @Summary 修改个人信息
// @Description 更新用户的个人信息
// @Accept json
// @Produce json
// @Param body body bind.BodyUserProfile true "参数"
// @Success 200 {object} httputil.JSONResponse
// @Failure 400 {object} httputil.JSONResponse
// @Failure 500 {object} httputil.JSONResponse
// @Router /v1/user/profile [put]
func (rs *UserResource) updateProfile(c *gin.Context) {
	p := new(bind.BodyUserProfile)
	if err := c.ShouldBindJSON(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	user, err := rs.dUser.Find(authed.UidGet(c))
	if err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	userProfile := new(model.UserProfile)
	userProfile.Avatar = p.Avatar
	userProfile.Nickname = p.Nickname
	userProfile.Bio = p.Bio
	userProfile.URL = p.URL
	userProfile.Company = p.Company
	userProfile.Location = p.Location
	if err := rs.dUser.UpdateProfile(user.Id, userProfile); err != nil {
		ginutil.JSONServerError(c, err)
		return
	}

	ginutil.JSON(c)
}
