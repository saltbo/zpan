package model

func Tables() []interface{} {
	return []interface{}{
		new(User),
		new(Storage),
		new(Matter),
		new(Share),
		new(Recycle),
	}
}
