package model

import "github.com/saltbo/zpan/internal/app/entity"

func Tables() []interface{} {
	return []interface{}{
		new(Option),
		new(User),
		new(UserKey),
		new(UserProfile),
		new(entity.UserStorage),
		new(entity.Storage),
		new(entity.Matter),
		new(Share),
		new(entity.RecycleBin),
	}
}
