package model

func Tables() []interface{} {
	return []interface{}{
		new(User),
		new(Option),
		new(Storage),
		new(Matter),
		new(Share),
		new(Recycle),
	}
}
