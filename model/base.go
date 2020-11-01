package model

func Tables() []interface{} {
	return []interface{}{
		new(User),
		new(Matter),
		new(Share),
		new(Recycle),
		new(Storage),
	}
}
