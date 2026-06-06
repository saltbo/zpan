package service

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strconv"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/saltbo/gopkg/jwtutil"
	"github.com/spf13/viper"
)

const jwtSecretConfigKey = "security.jwt_secret"

var temporaryJWTSecret string

type Token struct {
}

func NewToken() *Token {
	jwtutil.Init(JWTSecret())
	return &Token{}
}

func NewJWTUtil() *jwtutil.JWTUtil {
	return jwtutil.New(JWTSecret())
}

func EnsureJWTSecret() error {
	if viper.GetString(jwtSecretConfigKey) != "" {
		return nil
	}

	secret, err := generateJWTSecret()
	if err != nil {
		return err
	}

	viper.Set(jwtSecretConfigKey, secret)
	return nil
}

func JWTSecret() string {
	if secret := viper.GetString(jwtSecretConfigKey); secret != "" {
		return secret
	}

	if !viper.IsSet("installed") {
		if temporaryJWTSecret == "" {
			secret, err := generateJWTSecret()
			if err != nil {
				panic(fmt.Sprintf("generate temporary jwt secret failed: %s", err))
			}
			temporaryJWTSecret = secret
		}

		return temporaryJWTSecret
	}

	panic(fmt.Sprintf("missing required config %q", jwtSecretConfigKey))
}

func generateJWTSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(buf), nil
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
