package model

func Tables() []interface{} {
	return []interface{}{
		new(Option),
		new(User),
		new(UserProfile),
		new(UserStorage),
		new(Storage),
		new(Matter),
		new(Share),
		new(Recycle),
	}
}
