package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// TorrentRegistration is the server's answer to a cache download's info
// dictionary: what to do with the task, and the files to upload.
type TorrentRegistration struct {
	// Outcome is fill (upload into the cache), joined or completed (the task is
	// settled elsewhere; drop it), or drive (upload through the object API).
	Outcome  string        `json:"outcome"`
	InfoHash string        `json:"infoHash"`
	Name     string        `json:"name"`
	Files    []TorrentFile `json:"files"`
}

// TorrentFile is a file of the torrent, padding files left out. Path is
// slash-separated inside the torrent; a single-file torrent's is its name.
type TorrentFile struct {
	FileIdx int    `json:"fileIdx"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
}

const (
	TorrentOutcomeFill      = "fill"
	TorrentOutcomeJoined    = "joined"
	TorrentOutcomeCompleted = "completed"
	TorrentOutcomeDrive     = "drive"
)

// TorrentUpload is a presigned upload into the cache: one PUT, or the parts
// of a multipart upload.
type TorrentUpload struct {
	UploadID *string             `json:"uploadId"`
	PartSize int64               `json:"partSize"`
	Parts    []TorrentUploadPart `json:"parts"`
}

type TorrentUploadPart struct {
	PartNumber int    `json:"partNumber"`
	URL        string `json:"url"`
	Offset     int64  `json:"offset"`
	Length     int64  `json:"length"`
}

func (c *Client) RegisterTaskTorrent(ctx context.Context, token string, taskID string, info []byte) (TorrentRegistration, error) {
	body := map[string]string{"info": base64.StdEncoding.EncodeToString(info)}
	path := "/api/downloads/tasks/" + taskID + "/torrent"
	data, err := jsonBody(body)
	if err != nil {
		return TorrentRegistration{}, err
	}
	res, err := c.api.RegisterTaskTorrentWithBodyWithResponse(ctx, taskID, "application/json", data, bearer(token))
	if err != nil {
		return TorrentRegistration{}, err
	}
	var out TorrentRegistration
	return out, decodeStatus("PUT", path, res.StatusCode(), res.Body, &out, http.StatusOK)
}

func (c *Client) CreateTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int) (TorrentUpload, error) {
	path := "/api/downloads/tasks/" + taskID + "/torrent/files/" + strconv.Itoa(fileIdx) + "/uploads"
	res, err := c.api.CreateTorrentFileUploadWithResponse(ctx, taskID, fileIdx, bearer(token))
	if err != nil {
		return TorrentUpload{}, err
	}
	var out TorrentUpload
	return out, decodeStatus("POST", path, res.StatusCode(), res.Body, &out, http.StatusCreated)
}

func (c *Client) CompleteTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int, uploadID *string, parts []CompletedObjectUploadPart) error {
	path := "/api/downloads/tasks/" + taskID + "/torrent/files/" + strconv.Itoa(fileIdx) + "/completions"
	body := map[string]any{"uploadId": uploadID}
	if uploadID != nil {
		body["parts"] = completedParts(parts)
	}
	data, err := jsonBody(body)
	if err != nil {
		return err
	}
	res, err := c.api.CompleteTorrentFileUploadWithBodyWithResponse(ctx, taskID, fileIdx, "application/json", data, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("POST", path, res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) CreateTorrentSidecarUpload(ctx context.Context, token string, taskID string, n int, size int64) (TorrentUpload, error) {
	path := "/api/downloads/tasks/" + taskID + "/torrent/sidecars/" + strconv.Itoa(n) + "/uploads"
	data, err := jsonBody(map[string]int64{"size": size})
	if err != nil {
		return TorrentUpload{}, err
	}
	res, err := c.api.CreateTorrentSidecarUploadWithBodyWithResponse(ctx, taskID, n, "application/json", data, bearer(token))
	if err != nil {
		return TorrentUpload{}, err
	}
	var out TorrentUpload
	return out, decodeStatus("POST", path, res.StatusCode(), res.Body, &out, http.StatusCreated)
}

func (c *Client) CompleteTorrentSidecarUpload(ctx context.Context, token string, taskID string, n int) error {
	path := "/api/downloads/tasks/" + taskID + "/torrent/sidecars/" + strconv.Itoa(n) + "/completions"
	res, err := c.api.CompleteTorrentSidecarUploadWithResponse(ctx, taskID, n, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("POST", path, res.StatusCode(), res.Body, http.StatusOK)
}

// PutTaskTorrentLayout stores the upload layout of a scraped cache download.
func (c *Client) PutTaskTorrentLayout(ctx context.Context, token string, taskID string, layout any) error {
	path := "/api/downloads/tasks/" + taskID + "/torrent/layout"
	data, err := jsonBody(layout)
	if err != nil {
		return err
	}
	res, err := c.api.PutTaskTorrentLayoutWithBodyWithResponse(ctx, taskID, "application/json", data, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("PUT", path, res.StatusCode(), res.Body, http.StatusOK)
}

// CompleteTaskTorrent completes a cache download; the server finishes the task
// by instant transfer and returns it.
func (c *Client) CompleteTaskTorrent(ctx context.Context, token string, taskID string, files []TorrentFile) (DownloadTask, error) {
	path := "/api/downloads/tasks/" + taskID + "/torrent/completions"
	type uploaded struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	list := make([]uploaded, 0, len(files))
	for _, file := range files {
		list = append(list, uploaded{Path: file.Path, Size: file.Size})
	}
	data, err := jsonBody(map[string]any{"files": list})
	if err != nil {
		return DownloadTask{}, err
	}
	res, err := c.api.CompleteTaskTorrentWithBodyWithResponse(ctx, taskID, "application/json", data, bearer(token))
	if err != nil {
		return DownloadTask{}, err
	}
	var task DownloadTask
	return task, decodeStatus("POST", path, res.StatusCode(), res.Body, &task, http.StatusOK)
}

func completedParts(parts []CompletedObjectUploadPart) []map[string]any {
	out := make([]map[string]any, 0, len(parts))
	for _, part := range parts {
		out = append(out, map[string]any{"partNumber": part.PartNumber, "etag": part.ETag})
	}
	return out
}

func jsonBody(value any) (*bytes.Reader, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func decodeStatus(method string, path string, status int, body []byte, out any, expected ...int) error {
	if err := expectStatus(method, path, status, body, expected...); err != nil {
		return err
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%s %s failed: %w", method, path, err)
	}
	return nil
}
