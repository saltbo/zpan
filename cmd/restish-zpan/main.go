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
				"  RSH_PROFILE=file-manager restish zpan-upload --api zpan --profile file-manager ./photo.jpg\n" +
				"  RSH_PROFILE=ci restish zpan-upload --api zpan --profile ci --parent folder-id ./photo.jpg report.jpg\n" +
				"  RSH_PROFILE=file-manager restish zpan-upload --api zpan --profile file-manager --resume ./large.bin\n" +
				"  RSH_PROFILE=file-manager restish zpan-upload --api zpan --profile file-manager --abort ./large.bin",
		},
	}
}

func runCommand(command string, args []string, client *plugin.CommandClient) error {
	if command != "zpan-upload" {
		return fmt.Errorf("unknown command: %s", command)
	}
	return restishzpan.Run(os.Args[1:], args, restishzpan.NewPluginHost(client))
}
