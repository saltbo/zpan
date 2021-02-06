package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

const (
	OptSite  = "CORE_SITE"
	OptEmail = "CORE_EMAIL"
	//OptInvitation = "INVITATION"
)

type Option struct {
	Id      int64          `json:"id"`
	Name    string         `json:"name" gorm:"size:16;not null"`
	Opts    Opts           `json:"opts" gorm:"not null"`
	Created time.Time      `json:"created" gorm:"autoCreateTime"`
	Updated time.Time      `json:"updated" gorm:"autoUpdateTime"`
	Deleted gorm.DeletedAt `json:"-"`
}

func (Option) TableName() string {
	return "zp_option"
}

// Opts defiend JSON data type, need to implements driver.Valuer, sql.Scanner interface
type Opts map[string]interface{}

func (m Opts) GetString(name string) string {
	if v, ok := m[name].(string); ok {
		return v
	}

	return ""
}

func (m Opts) GetBool(name string) bool {
	if v, ok := m[name].(bool); ok {
		return v
	}

	return false
}

func (m Opts) GetInt(name string) int {
	if v, ok := m[name].(int); ok {
		return v
	}

	return 0
}

// Value return json value, implement driver.Valuer interface
func (m Opts) Value() (driver.Value, error) {
	if m == nil {
		return nil, nil
	}
	ba, err := m.MarshalJSON()
	return string(ba), err
}

// Scan scan value into Jsonb, implements sql.Scanner interface
func (m *Opts) Scan(val interface{}) error {
	var ba []byte
	switch v := val.(type) {
	case []byte:
		ba = v
	case string:
		ba = []byte(v)
	default:
		return errors.New(fmt.Sprint("Failed to unmarshal JSONB value:", val))
	}
	t := map[string]interface{}{}
	err := json.Unmarshal(ba, &t)
	*m = Opts(t)
	return err
}

// MarshalJSON to output non base64 encoded []byte
func (m Opts) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	t := (map[string]interface{})(m)
	return json.Marshal(t)
}

// UnmarshalJSON to deserialize []byte
func (m *Opts) UnmarshalJSON(b []byte) error {
	t := map[string]interface{}{}
	err := json.Unmarshal(b, &t)
	*m = Opts(t)
	return err
}

// GormDataType gorm common data type
func (m Opts) GormDataType() string {
	return "jsonmap"
}

// GormDBDataType gorm db data type
func (Opts) GormDBDataType(db *gorm.DB, field *schema.Field) string {
	switch db.Dialector.Name() {
	case "sqlite":
		return "TEXT"
	case "mysql":
		return "TEXT"
	case "postgres":
		return "TEXT"
	}
	return ""
}
