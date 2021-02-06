package service

import (
	"encoding/base64"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"

	"gopkg.in/gomail.v2"

	"github.com/saltbo/zpan/internal/app/model"
)

const (
	mailKindAccountActive = "account-active"
	mailKindPasswordReset = "password-reset"
)

var (
	mailLinks = map[string]string{
		mailKindAccountActive: "%s/u/signin/%s",
		mailKindPasswordReset: "%s/u/password-reset/%s",
	}
	defaultTemplates = map[string]string{
		mailKindAccountActive: "<h3>账户激活链接</h3>\n       <p><a href=\"%s\">点击此处账户激活</a></p>\n\t\t<p>如果您没有进行账号注册请忽略！</p>",
		mailKindPasswordReset: "<h3>密码重置链接</h3>\n       <p><a href=\"%s\">点击此处重置密码</a></p>\n\t\t<p>如果您没有申请重置密码请忽略！</p>",
	}
	once sync.Once
	mail *Mail
)

type Mail struct {
	dialer *gomail.Dialer

	from      string
	templates map[string]string
	enabled   bool
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
	host, port, err := splitHostPort(opt.GetString("address"))
	if err != nil {
		return err
	}

	dialer := gomail.NewDialer(host, port, opt.GetString("username"), opt.GetString("password"))
	if _, err := dialer.Dial(); err != nil {
		return err
	}

	m.dialer = dialer
	m.enabled = opt.GetBool("enabled")
	m.from = fmt.Sprintf("%s <%s>", opt.GetString("sender"), opt.GetString("username"))
	if v, ok := opt["tpl_password_reset"]; ok {
		m.templates[mailKindPasswordReset] = v.(string)
	}
	if v, ok := opt["tpl_account_active"]; ok {
		m.templates[mailKindAccountActive] = v.(string)
	}
	return nil
}

func (m *Mail) NotifyActive(siteAddr, email string, token string) error {
	msg := gomail.NewMessage()
	msg.SetHeader("From", m.from)
	msg.SetHeader("To", email)
	msg.SetHeader("Subject", "账户激活")
	msg.SetBody("text/html", m.buildMailBody(mailKindAccountActive, siteAddr, email, token))
	return m.dialer.DialAndSend(msg)
}

func (m *Mail) NotifyPasswordReset(siteAddr, email, token string) error {
	msg := gomail.NewMessage()
	msg.SetHeader("From", m.from)
	msg.SetHeader("To", email)
	msg.SetHeader("Subject", "密码重置申请")
	msg.SetBody("text/html", m.buildMailBody(mailKindPasswordReset, siteAddr, email, token))
	return m.dialer.DialAndSend(msg)
}

func (m *Mail) buildMailBody(kind, siteAddr, email, token string) string {
	link := fmt.Sprintf(mailLinks[kind], siteAddr, encodeToKey(email, token))
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

func splitHostPort(hostport string) (host string, port int, err error) {
	host, portStr, err := net.SplitHostPort(hostport)
	if err != nil {
		return "", 0, fmt.Errorf("invalid smpt-addr: %s", err)
	}

	port, err = strconv.Atoi(portStr)
	if err != nil {
		return "", 0, fmt.Errorf("invalid port: %s", err)
	}

	return host, port, nil
}
