package service

import (
	"fmt"
	"strconv"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/saltbo/gopkg/jwtutil"
)

type Token struct {
}

func NewToken() *Token {
	jwtutil.Init("123")
	return &Token{}
}

func (s *Token) Create(uid string, ttl int, roles ...string) (string, error) {
	return jwtutil.Issue(NewRoleClaims(uid, ttl, roles))
}

func (s *Token) Verify(tokenStr string) (*RoleClaims, error) {
	token, err := jwtutil.Verify(tokenStr, &RoleClaims{})
	if err != nil {
		return nil, fmt.Errorf("token valid failed: %s", err)
	}

	return token.Claims.(*RoleClaims), nil
}

type RoleClaims struct {
	jwt.StandardClaims

	Roles []string `json:"roles"`
}

func NewRoleClaims(subject string, ttl int, roles []string) *RoleClaims {
	timeNow := time.Now()
	return &RoleClaims{
		StandardClaims: jwt.StandardClaims{
			Issuer:    "zplat",
			Audience:  "zplatUsers",
			ExpiresAt: timeNow.Add(time.Duration(ttl) * time.Second).Unix(),
			IssuedAt:  timeNow.Unix(),
			NotBefore: timeNow.Unix(),
			Subject:   subject,
		},
		Roles: roles,
	}
}

func (rc *RoleClaims) Uid() int64 {
	uid, _ := strconv.ParseInt(rc.Subject, 10, 64)
	return uid
}
