package entity

import (
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/saltbo/gopkg/strutil"
	"github.com/saltbo/gopkg/timeutil"
)

type MatterEnv struct {
	Name    string `json:"name"`
	Intro   string `json:"intro"`
	Example string `json:"example"`

	builder func(m *Matter) string
}

func (env *MatterEnv) buildV(m *Matter) string {
	return env.builder(m)
}

var SupportEnvs = []MatterEnv{
	{Name: "$UID", Intro: "用户ID", Example: "10001", builder: func(m *Matter) string { return strconv.FormatInt(m.Uid, 10) }},
	{Name: "$UUID", Intro: "UUID", Example: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", builder: func(m *Matter) string { return uuid.New().String() }},
	{Name: "$RAW_PATH", Intro: "初始上传路径", Example: "文稿/简历", builder: func(m *Matter) string { return m.Parent }},
	{Name: "$RAW_NAME", Intro: "初始文件名", Example: "张三-简历", builder: func(m *Matter) string { return m.Name }},
	{Name: "$RAW_EXT", Intro: "初始文件后缀", Example: "pdf", builder: func(m *Matter) string { return filepath.Ext(m.Name)[1:] }},
	{Name: "$RAND_8KEY", Intro: "8位随机字符", Example: "mCUoR35r", builder: func(m *Matter) string { return strutil.RandomText(8) }},
	{Name: "$RAND_16KEY", Intro: "16位随机字符", Example: "e1CbDUNfyVP3sScJ", builder: func(m *Matter) string { return strutil.RandomText(16) }},
	{Name: "$NOW_DATE", Intro: "当前时间-日期", Example: "20210101", builder: func(m *Matter) string { return timeutil.Format(time.Now(), "YYYYMMDD") }},
	{Name: "$NOW_YEAR", Intro: "当前时间-年", Example: "2021", builder: func(m *Matter) string { return strconv.Itoa(time.Now().Year()) }},
	{Name: "$NOW_MONTH", Intro: "当前时间-月", Example: "01", builder: func(m *Matter) string { return strconv.Itoa(int(time.Now().Month())) }},
	{Name: "$NOW_DAY", Intro: "当前时间-日", Example: "01", builder: func(m *Matter) string { return strconv.Itoa(time.Now().Day()) }},
	{Name: "$NOW_HOUR", Intro: "当前时间-时", Example: "12", builder: func(m *Matter) string { return strconv.Itoa(time.Now().Hour()) }},
	{Name: "$NOW_MIN", Intro: "当前时间-分", Example: "30", builder: func(m *Matter) string { return strconv.Itoa(time.Now().Minute()) }},
	{Name: "$NOW_SEC", Intro: "当前时间-秒", Example: "10", builder: func(m *Matter) string { return strconv.Itoa(time.Now().Second()) }},
	{Name: "$NOW_UNIX", Intro: "当前时间-时间戳", Example: "1612631185", builder: func(m *Matter) string { return fmt.Sprint(time.Now().Unix()) }},
}
