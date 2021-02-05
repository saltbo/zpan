package service

import (
	"encoding/base64"
	"fmt"
	"strings"
	"sync"

	"github.com/saltbo/gopkg/mailutil"

	"github.com/saltbo/zpan/internal/app/model"
)

const (
	mailKindAccountActive = "account-active"
	mailKindPasswordReset = "password-reset"
)

var (
	mailLinks = map[string]string{
		mailKindAccountActive: "%s/zplat/signin/%s",
		mailKindPasswordReset: "%s/zplat/password-reset/%s",
	}
	defaultTemplates = map[string]string{
		mailKindAccountActive: "<h3>账户激活链接</h3>\n       <p><a href=\"%s\">点击此处账户激活</a></p>\n\t\t<p>如果您没有进行账号注册请忽略！</p>",
		mailKindPasswordReset: "<h3>密码重置链接</h3>\n       <p><a href=\"%s\">点击此处重置密码</a></p>\n\t\t<p>如果您没有申请重置密码请忽略！</p>",
	}
	once sync.Once
	mail *Mail
)

type Mail struct {
	cli *mailutil.Mail

	enabled   bool
	templates map[string]string
}

func NewMail() *Mail {
	once.Do(func() {
		mail = &Mail{
			templates: defaultTemplates,
		}
		OptRegister("email", mail.Boot)
	})
	return mail
}

func (m *Mail) Enabled() bool {
	return m.enabled
}

func (m *Mail) Boot(opt model.Opts) error {
	if v, ok := opt["tpl_password_reset"]; ok {
		m.templates[mailKindPasswordReset] = v.(string)
	}
	if v, ok := opt["tpl_account_active"]; ok {
		m.templates[mailKindAccountActive] = v.(string)
	}

	m.enabled = opt.GetBool("enabled")
	conf := mailutil.Config{
		Host:     opt.GetString("host"),
		Sender:   opt.GetString("sender"),
		Username: opt.GetString("username"),
		Password: opt.GetString("password"),
	}
	cli, err := mailutil.NewMail(conf)
	if err != nil {
		return err
	}

	m.cli = cli
	return nil
}

func (m *Mail) NotifyActive(email string, token string) error {
	return m.cli.Send("账户激活", email, m.buildMailBody(mailKindAccountActive, email, token))
}

func (m *Mail) NotifyPasswordReset(email string, token string) error {
	return m.cli.Send("密码重置申请", email, m.buildMailBody(mailKindPasswordReset, email, token))
}

func (m Mail) SendTest(email string) error {
	return m.cli.Send("邮箱配置测试", email, "Success")
}

func (m *Mail) buildMailBody(kind, email, token string) string {
	origin := ""
	link := fmt.Sprintf(mailLinks[kind], origin, encodeToKey(email, token))
	return fmt.Sprintf(m.templates[kind], link)
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
