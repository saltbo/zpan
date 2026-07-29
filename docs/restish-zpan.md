# Restish ZPan Upload Plugin

`restish-zpan` contributes the `restish zpan-upload` command. It uses Restish
profiles for ZPan API calls and streams file bytes directly from disk to
presigned storage URLs.

The companion [ZPan Agent Skill](agent-skill.md) selects when to use generated
Restish commands and when to invoke this plugin. The Skill does not implement
multipart upload behavior itself.

## Install

Restish plugins are trusted local executable code. Agents must explain that
trust boundary and get explicit user approval for the `saltbo/zpan` source
before installing:

```bash
restish plugin install saltbo/zpan zpan
```

## Usage

```bash
restish zpan-upload ./photo.jpg
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --parent albums ./photo.jpg cover.jpg
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --resume ./large.bin
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --abort ./large.bin
```

The plugin validates the connected ZPan OpenAPI operations before uploading:
`createObject`, `presignObjectUploadParts`, `completeObjectUpload`, and
`abortObjectUpload`.

Control-plane calls are delegated to Restish so host configuration, auth, TLS,
cache policy, and output formatting stay host-owned. Presigned storage PUTs use
native Go HTTP because file bytes and presigned URLs must not cross the plugin
CBOR channel.

Local checkpoints are written with mode `0600` under the user cache directory.
They contain API/profile identity, source file identity, destination identity,
the ZPan object/session IDs, part size/count, and completed part ETags. They do
not contain credentials, cookies, presigned URLs, or file bytes.

Restish v2.3 delegated HTTP uses the host's active profile. Select profiles with
Restish's global profile flag or `RSH_PROFILE`; the plugin's `--profile` value is
used for spec validation and checkpoint identity.
