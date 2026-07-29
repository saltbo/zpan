# CI and Unattended Automation

Use the `ci` Restish profile for unattended jobs. The profile reads the Agent
API key from the environment and does not require token copy/paste:

```sh
export ZPAN_AGENT_API_KEY="$ZPAN_AGENT_API_KEY"
restish --rsh-profile ci zpan listObjects --parent root --limit 50
restish --rsh-profile ci zpan-upload --api zpan --parent releases ./dist/app.tar.gz
```

The key must be created by a user in ZPan Agent Access settings, scoped to one
workspace, named for the environment, given explicit permissions, and stored in
the CI secret store. The plaintext key is shown once by ZPan and should never be
posted into chat, logs, issue comments, or PR output.

Use separate keys for separate environments. Expired or revoked keys are
terminal; create a new key when the job needs a different lifetime.

When a job receives `403`, report the missing operation and expected scope. Do
not broaden the requested scopes automatically. The user should decide whether
to issue a new key or approve a broader scope set.
