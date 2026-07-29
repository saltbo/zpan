package main

import (
	"fmt"
	"os"

	"github.com/rest-sh/restish/v2/plugin"
	"github.com/saltbo/zpan/internal/restishzpan"
)

var version = "dev"

func main() {
	plugin.Run(manifest(), commands(), runCommand)
}

func manifest() plugin.Manifest {
	return plugin.Manifest{
		Name:              "zpan",
		Version:           version,
		Description:       "ZPan upload workflow commands for Restish",
		RestishAPIVersion: 2,
		Hooks:             []string{"command"},
		NeedsAuthSecrets:  false,
	}
}

func commands() []plugin.CommandDecl {
	return []plugin.CommandDecl{
		{
			Name:  "zpan-upload",
			Short: "Upload a local file to ZPan",
			Long: "Upload a local file to ZPan using Restish-managed API auth and direct presigned storage PUTs.\n\n" +
				"Examples:\n" +
				"  restish zpan-upload ./photo.jpg\n" +
				"  restish --rsh-profile ci zpan-upload --parent folder-id ./photo.jpg report.jpg\n" +
				"  restish zpan-upload --resume ./large.bin\n" +
				"  restish zpan-upload --abort ./large.bin",
		},
	}
}

func runCommand(command string, args []string, client *plugin.CommandClient) error {
	if command != "zpan-upload" {
		return fmt.Errorf("unknown command: %s", command)
	}
	return restishzpan.Run(os.Args[1:], args, restishzpan.NewPluginHost(client))
}
