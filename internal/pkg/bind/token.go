package bind

type BodyToken struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password"`
	Captcha  string `json:"captcha"`
}
