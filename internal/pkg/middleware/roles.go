package middleware

//func Roles() grbac.Rules {
//	return grbac.Rules{
//		{
//			Resource: &meta.Resource{
//				Host:   "*",
//				Path:   "/api/files",
//				Method: "{GET,POST}",
//			},
//			Permission: &meta.Permission{
//				AllowAnyone: true,
//			},
//		},
//		{
//			Resource: &meta.Resource{
//				Host:   "*",
//				Path:   "/s/**",
//				Method: "{GET}",
//			},
//			Permission: &meta.Permission{
//				AllowAnyone: true,
//			},
//		},
//		{
//			Resource: &meta.Resource{
//				Host:   "*",
//				Path:   "/api/shares/**",
//				Method: "{GET}",
//			},
//			Permission: &meta.Permission{
//				AllowAnyone: true,
//			},
//		},
//	}
//}
