package service

import (
	"testing"

	"github.com/dgrijalva/jwt-go"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetTokenConfig(t *testing.T) {
	t.Helper()

	viper.Reset()
	temporaryJWTSecret = ""
	t.Cleanup(func() {
		viper.Reset()
		temporaryJWTSecret = ""
	})
}

func TestTokenRejectsHardcodedSecret(t *testing.T) {
	resetTokenConfig(t)
	viper.Set("installed", true)
	viper.Set(jwtSecretConfigKey, "configured-secret")

	tokenService := NewToken()
	forgedToken, err := jwt.NewWithClaims(
		jwt.SigningMethodHS512,
		NewRoleClaims("1", 3600, []string{"admin"}),
	).SignedString([]byte("123"))
	require.NoError(t, err)

	_, err = tokenService.Verify(forgedToken)
	assert.Error(t, err)

	validToken, err := tokenService.Create("1", 3600, "admin")
	require.NoError(t, err)

	claims, err := tokenService.Verify(validToken)
	require.NoError(t, err)
	assert.Equal(t, "1", claims.Subject)
	assert.Equal(t, []string{"admin"}, claims.Roles)
}

func TestTokenRequiresConfiguredSecretAfterInstall(t *testing.T) {
	resetTokenConfig(t)
	viper.Set("installed", true)

	assert.Panics(t, func() {
		NewToken()
	})
}

func TestEnsureJWTSecretGeneratesPersistentConfig(t *testing.T) {
	resetTokenConfig(t)

	require.NoError(t, EnsureJWTSecret())

	secret := viper.GetString(jwtSecretConfigKey)
	assert.NotEmpty(t, secret)
	assert.NotEqual(t, "123", secret)
}
