package downloader

type registration struct {
	name       string
	fallback   bool
	configured func(Config) bool
	new        func(Config) (Downloader, error)
}

var registeredDownloaders []registration

func Register(
	name string,
	fallback bool,
	configured func(Config) bool,
	new func(Config) (Downloader, error),
) {
	if name == "" {
		panic("downloader: register downloader with empty name")
	}
	if configured == nil {
		configured = func(Config) bool { return false }
	}
	if new == nil {
		panic("downloader: register downloader with nil constructor")
	}
	entry := registration{name: name, fallback: fallback, configured: configured, new: new}
	for i, existing := range registeredDownloaders {
		if existing.name == name {
			registeredDownloaders[i] = entry
			return
		}
	}
	registeredDownloaders = append(registeredDownloaders, entry)
}

func registrations() []registration {
	return append([]registration(nil), registeredDownloaders...)
}
