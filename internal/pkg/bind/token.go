package bind

type BodyToken struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
	Captcha  string `json:"captcha"`
}
