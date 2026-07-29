# Upload Workflows

Every local file upload must use the Restish command plugin:

```sh
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --parent root ./artifact.zip
```

The Skill must not implement upload chunking or upload orchestration.
`restish-zpan` validates `createObject`, `presignObjectUploadParts`,
`completeObjectUpload`, and `abortObjectUpload`, then creates or resumes ZPan
upload sessions through Restish delegated HTTP, streams file parts from disk to
storage, records storage responses, retries parts, and removes safe checkpoints
after completion.

## Before Uploading

Confirm:

- the target workspace;
- the target folder or parent object ID;
- whether a same-name destination should fail, rename, or replace;
- plugin trust if `restish zpan-upload` is not installed yet.

Install only after explicit source approval:

```sh
restish plugin install saltbo/zpan zpan
```

## Upload

Use the selected Restish profile and API name explicitly:

```sh
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --parent folder_456 ./release.tar.gz
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --parent folder_456 ./release.tar.gz release-linux.tar.gz
```

If the plugin supports a conflict flag in the installed version, pass only the
user-approved policy.

## Resume and Abort

Resume interrupted local uploads through the plugin:

```sh
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --resume ./release.tar.gz
```

Abort an upload only after confirmation:

```sh
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --abort ./release.tar.gz
```

## Output

Return a compact summary with object ID, object URL or share URL when relevant,
parent ID, upload mode, part count, bytes uploaded, task state, and quota effect
when reported. Do not expose storage upload URLs, bearer tokens, API keys,
cookies, or checkpoint contents.
