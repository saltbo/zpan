package model

func Tables() []interface{} {
	return []interface{}{
		new(Matter),
		new(Share),
		new(User),
	}
}
