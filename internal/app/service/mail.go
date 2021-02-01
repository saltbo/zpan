package service

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/saltbo/gopkg/mailutil"
)

const (
	mailKindAccountActive = "account-active"
	mailKindPasswordReset = "password-reset"
)

var mailLinks = map[string]string{
	mailKindAccountActive: "%s/zplat/signin/%s",
	mailKindPasswordReset: "%s/zplat/password-reset/%s",
}

type Mail struct {
	cli *mailutil.Mail

	activeTpl, resetTpl string
}

func NewMail() *Mail {
	return &Mail{
		activeTpl: `
       <h3>账户激活链接</h3>
       <p><a href="%s">点击此处账户激活</a></p>
		<p>如果您没有进行账号注册请忽略！</p>
       `,
		resetTpl: `
       <h3>密码重置链接</h3>
       <p><a href="%s">点击此处重置密码</a></p>
		<p>如果您没有申请重置密码请忽略！</p>
       `,
	}
}

func (m *Mail) SendSignupSuccessNotify(email string, token string) error {
	return m.cli.Send("账户激活", email, m.buildMailBody(mailKindAccountActive, email, token))
}

func (m *Mail) SendPasswordResetNotify(email string, token string) error {
	return m.cli.Send("密码重置申请", email, m.buildMailBody(mailKindPasswordReset, email, token))
}

func (m *Mail) buildMailBody(kind, email, token string) string {
	origin := ""
	link := fmt.Sprintf(mailLinks[kind], origin, encodeToKey(email, token))
	bodyTpl := m.activeTpl
	if kind == mailKindPasswordReset {
		bodyTpl = m.resetTpl
	}

	return fmt.Sprintf(bodyTpl, link)
}

var base64Encode = base64.URLEncoding.EncodeToString
var base64Decode = base64.URLEncoding.DecodeString

const zplatSplitKey = "|zplat|"

func encodeToKey(email, token string) string {
	return base64Encode([]byte(email + zplatSplitKey + token))
}

func decodeFromKey(key string) (email, token string) {
	bb, _ := base64Decode(key)
	sss := strings.Split(string(bb), zplatSplitKey)
	email = sss[0]
	token = sss[1]
	return
}
