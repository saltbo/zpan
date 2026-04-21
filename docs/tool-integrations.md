# Tool Integrations

ZPan Image Hosting integrates with popular screenshot and upload tools. All configuration is generated client-side from your API key — the server never stores or transmits plaintext keys.

## Prerequisites

1. Enable Image Hosting in your ZPan workspace.
2. Create an API key under **Settings → Image Hosting → API Keys**.
3. **Save the key immediately** — it is only shown once at creation time.
4. Navigate to **Settings → Image Hosting → Tool Integration** and paste the key you saved.

---

## PicGo / PicList

PicGo is a cross-platform image uploader with a plugin ecosystem.

### Installation

```bash
# Install the web-uploader plugin (CLI)
picgo install picgo-plugin-web-uploader

# Or use the GUI Plugin Manager: search for "web-uploader" and install
```

### Configuration

1. Open PicGo → **Settings** → **Uploader** → **Custom Web**.
2. Generate the JSON in the Tool Integration panel and paste it into the Custom Web configuration.
3. Set **Custom Web** as the default uploader.
4. Click **Test** to verify the upload works.

The generated JSON looks like:

```json
{
  "url": "https://<your-zpan-host>/api/ihost/images",
  "paramName": "file",
  "jsonPath": "data.url",
  "customHeader": "{\"Authorization\":\"Bearer <your-key>\"}",
  "customBody": "{\"path\":\"{year}/{month}/{fileName}\"}"
}
```

---

## uPic (macOS)

uPic is a macOS image uploader that supports custom HTTP hosts.

### Configuration

1. Open uPic → **Preferences** → **Host** → click **+** → choose **Custom**.
2. Generate the JSON in the Tool Integration panel.
3. In uPic, use **File → Import Config** and select the generated JSON file (save it first).

Alternatively, fill in the fields manually:

| Field | Value |
|-------|-------|
| API URL | `https://<host>/api/ihost/images` |
| File Form Key | `file` |
| Authorization Header | `Bearer <your-key>` |
| Response Field | `data.url` |

---

## ShareX (Windows)

ShareX supports custom upload targets via `.sxcu` configuration files.

### Installation

1. Generate and download the `zpan-ihost.sxcu` file from the Tool Integration panel.
2. Double-click the file — ShareX will automatically import it as a custom uploader.
3. In ShareX go to **Destinations** → **Custom Uploader Settings** → verify "ZPan Image Host" is listed.
4. Set the active destination to **ZPan Image Host** under **Destinations → Image Uploader**.

The `.sxcu` file contains:

```json
{
  "Version": "15.0.0",
  "Name": "ZPan Image Host",
  "DestinationType": "ImageUploader, FileUploader",
  "RequestMethod": "POST",
  "RequestURL": "https://<host>/api/ihost/images",
  "Headers": { "Authorization": "Bearer <your-key>" },
  "Body": "MultipartFormData",
  "FileFormName": "file",
  "Arguments": { "path": "%y/%mo/$filename$" },
  "URL": "{json:data.url}",
  "ErrorMessage": "{json:error}"
}
```

---

## Flameshot (Linux)

Flameshot is an open-source screenshot tool with scripting support.

### Requirements

- `curl`
- `jq`
- `xclip` (X11) or `wl-clipboard` (`wl-copy`) for Wayland

### Usage

1. Copy the generated script from the Tool Integration panel.
2. Save it as `~/bin/zpan-upload.sh` and make it executable:

```bash
chmod +x ~/bin/zpan-upload.sh
```

3. Run after capture:

```bash
flameshot gui --raw | ~/bin/zpan-upload.sh
```

Or bind it as a keyboard shortcut in your desktop environment.

The script:

```bash
IHOST_KEY="<your-key>"
flameshot gui --raw | curl \
  -H "Authorization: Bearer $IHOST_KEY" \
  -F "file=@-" \
  -F "path=screenshots/$(date +%Y/%m)/$(date +%s).png" \
  https://<host>/api/ihost/images \
  | jq -r '.data.url' | xclip -selection clipboard
```

For Wayland, replace `xclip -selection clipboard` with `wl-copy`.

See [Flameshot scripting docs](https://flameshot.org/docs/guide/troubleshooting/) for more configuration options.

---

## Security Notes

- API keys are hashed on the server. **Never** share your key or commit it to version control.
- Keys can be revoked any time under **Settings → Image Hosting → API Keys**.
- The pasted key in the Tool Integration panel is ephemeral — it is never persisted to `localStorage` or sent to the server.
