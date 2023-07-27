package entity

import "time"

type RecycleBin struct {
	Id      int64  `json:"id"`
	Uid     int64  `json:"uid" gorm:"not null"`
	Sid     int64  `json:"sid" gorm:"not null"` // storage_id
	Mid     int64  `json:"mid" gorm:"not null"` // matter_id
	Alias   string `json:"alias" gorm:"size:16;not null"`
	Name    string `json:"name" gorm:"not null"`
	Type    string `json:"type" gorm:"not null"`
	Size    int64  `json:"size" gorm:"not null"`
	DirType int8   `json:"dirtype" gorm:"column:dirtype;not null"`

	CreatedAt time.Time  `json:"created" gorm:"not null"`
	DeletedAt *time.Time `json:"deleted"`
}

func (m *RecycleBin) GetID() string {
	return m.Alias
}

func (m *RecycleBin) TableName() string {
	return "zp_recycle"
}

func (m *RecycleBin) IsDir() bool {
	return m.DirType > 0
}

func (m *RecycleBin) UserAccessible(uid int64) bool {
	return m.Uid == uid
}
