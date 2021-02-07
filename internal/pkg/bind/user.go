package bind

type QueryUser struct {
	QueryPage2
	Email string `form:"email"`
}

type BodyUserCreation struct {
	Email      string `json:"email" binding:"required"`
	Password   string `json:"password" binding:"required"`
	Ticket     string `json:"ticket"`
	Roles      string `json:"roles"`
	StorageMax uint64 `json:"storage_max"`
}

type BodyUserPatch struct {
	Token     string `json:"token" binding:"required"`
	Password  string `json:"password"`
	Activated bool   `json:"activated"`
}

type BodyUserProfile struct {
	Avatar   string `json:"avatar"`
	Nickname string `json:"nickname"`
	Bio      string `json:"bio"`
	URL      string `json:"url"`
	Company  string `json:"company"`
	Location string `json:"location"`
	Locale   string `json:"locale"`
}

type BodyUserPassword struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

type BodyUserStorage struct {
	Max uint64 `json:"max"`
}
