//  Copyright 2019 The Go Authors. All rights reserved.
//  Use of this source code is governed by a BSD-style
//  license that can be found in the LICENSE file.

package version

import "fmt"

var (
	// RELEASE returns the release version
	release = "unknown"
	// REPO returns the git repository URL
	repo = "unknown"
	// COMMIT returns the short sha from git
	commit = "unknown"

	Short = fmt.Sprintf("%s", release)
	Long  = fmt.Sprintf("release: %s, repo: %s, commit: %s", release, repo, commit)
)
