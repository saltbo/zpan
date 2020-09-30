package model

import "time"

type Recycle struct {
	Id        int64      `json:"id"`
	Uid       int64      `json:"uid" gorm:"not null"`
	Alias     string     `json:"alias" gorm:"size:16;not null"`
	Name      string     `json:"name" gorm:"not null"`
	Type      string     `json:"type" gorm:"not null"`
	Size      int64      `json:"size" gorm:"not null"`
	DirType   int8       `json:"dirtype" gorm:"column:dirtype;not null"`
	Parent    string     `json:"parent" gorm:"not null"`
	Object    string     `json:"object" gorm:"not null"`
	CreatedAt time.Time  `json:"created" gorm:"not null"`
	DeletedAt *time.Time `json:"deleted"`
}

func (Recycle) TableName() string {
	return "zp_recycle"
}

func (m *Recycle) FullPath() string {
	fp := m.Parent + m.Name
	if m.DirType > 0 {
		fp += "/"
	}

	return fp
}

func (m *Recycle) IsDir() bool {
	return m.DirType > 0
}

func (m *Recycle) UserAccessible(uid int64) bool {
	return m.Uid == uid
}
