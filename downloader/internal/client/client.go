package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/saltbo/zpan/downloader/internal/openapi"
)

type Client struct {
	baseURL string
	token   string
	api     *openapi.ClientWithResponses
}

type Page[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

type DownloadTask struct {
	ID                   string              `json:"id"`
	SourceType           string              `json:"sourceType"`
	SourceURI            string              `json:"sourceUri"`
	Name                 string              `json:"name"`
	TargetFolder         string              `json:"targetFolder"`
	Category             string              `json:"category"`
	Tags                 []string            `json:"tags"`
	Status               string              `json:"status"`
	DownloadedBytes      int64               `json:"downloadedBytes"`
	StorageUploadedBytes int64               `json:"storageUploadedBytes"`
	TotalBytes           *int64              `json:"totalBytes"`
	DownloadBps          int64               `json:"downloadBps"`
	StorageUploadBps     int64               `json:"storageUploadBps"`
	Detail               *DownloadTaskDetail `json:"detail"`
	ResultObjectID       string              `json:"resultObjectId"`
	UploadToken          string              `json:"uploadToken"`
	AssignedDownloaderID string              `json:"assignedDownloaderId"`
}

type DownloadTaskDetail struct {
	Engine            string                `json:"engine,omitempty"`
	Phase             string                `json:"phase,omitempty"`
	EngineState       string                `json:"engineState,omitempty"`
	Message           string                `json:"message,omitempty"`
	ETASeconds        *int64                `json:"etaSeconds,omitempty"`
	Connections       *int64                `json:"connections,omitempty"`
	InfoHash          string                `json:"infoHash,omitempty"`
	TorrentName       string                `json:"torrentName,omitempty"`
	Seeders           *int64                `json:"seeders,omitempty"`
	Leechers          *int64                `json:"leechers,omitempty"`
	Peers             *int64                `json:"peers,omitempty"`
	PeerUploadedBytes *int64                `json:"peerUploadedBytes,omitempty"`
	PeerUploadBps     *int64                `json:"peerUploadBps,omitempty"`
	Trackers          []DownloadTaskTracker `json:"trackers,omitempty"`
	PeerSamples       []DownloadTaskPeer    `json:"peerSamples,omitempty"`
	Files             []DownloadTaskFile    `json:"files,omitempty"`
}

type DownloadTaskTracker struct {
	URL      string `json:"url"`
	Status   string `json:"status,omitempty"`
	Peers    *int64 `json:"peers,omitempty"`
	Seeds    *int64 `json:"seeds,omitempty"`
	Leechers *int64 `json:"leechers,omitempty"`
	Message  string `json:"message,omitempty"`
}

type DownloadTaskPeer struct {
	Address     string   `json:"address"`
	Client      string   `json:"client,omitempty"`
	Progress    *float64 `json:"progress,omitempty"`
	DownloadBps *int64   `json:"downloadBps,omitempty"`
	UploadBps   *int64   `json:"uploadBps,omitempty"`
}

type DownloadTaskFile struct {
	Path           string `json:"path"`
	Size           int64  `json:"size"`
	CompletedBytes *int64 `json:"completedBytes,omitempty"`
	Selected       *bool  `json:"selected,omitempty"`
}

type Heartbeat struct {
	Version            string   `json:"version"`
	Hostname           string   `json:"hostname"`
	Platform           string   `json:"platform"`
	Arch               string   `json:"arch"`
	Engine             string   `json:"engine"`
	Capabilities       []string `json:"capabilities"`
	MaxConcurrentTasks int      `json:"maxConcurrentTasks"`
	CurrentTasks       int      `json:"currentTasks"`
	DownloadBps        int64    `json:"downloadBps"`
	UploadBps          int64    `json:"uploadBps"`
	FreeDiskBytes      int64    `json:"freeDiskBytes"`
}

type TaskPatch struct {
	Status               string              `json:"status,omitempty"`
	DownloadedBytes      *int64              `json:"downloadedBytes,omitempty"`
	StorageUploadedBytes *int64              `json:"storageUploadedBytes,omitempty"`
	TotalBytes           *int64              `json:"totalBytes,omitempty"`
	DownloadBps          *int64              `json:"downloadBps,omitempty"`
	StorageUploadBps     *int64              `json:"storageUploadBps,omitempty"`
	ErrorMessage         *string             `json:"errorMessage,omitempty"`
	ResultObjectID       *string             `json:"resultObjectId,omitempty"`
	Detail               *DownloadTaskDetail `json:"detail,omitempty"`
}

type ObjectDraft struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	UploadURL          string `json:"uploadUrl"`
	ContentDisposition string `json:"contentDisposition,omitempty"`
}

type ObjectUploadSession struct {
	ID       string `json:"id"`
	ObjectID string `json:"objectId"`
	UploadID string `json:"uploadId"`
	PartSize int64  `json:"partSize"`
}

type PresignedObjectUploadPart struct {
	PartNumber int    `json:"partNumber"`
	URL        string `json:"url"`
}

type CompletedObjectUploadPart struct {
	PartNumber int    `json:"partNumber"`
	ETag       string `json:"etag"`
}

const (
	dirTypeFile       = 0
	dirTypeUserFolder = 1
)

type DeviceCode struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type DeviceToken struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Scope       string `json:"scope"`
}

type CreateDownloaderRequest struct {
	Name      string    `json:"name"`
	Heartbeat Heartbeat `json:"heartbeat"`
}

type CreateDownloaderResponse struct {
	Downloader struct {
		ID string `json:"id"`
	} `json:"downloader"`
	Token string `json:"token"`
}

func New(baseURL, token string) *Client {
	httpClient := &http.Client{Timeout: 60 * time.Second}
	api, err := openapi.NewClientWithResponses(strings.TrimRight(baseURL, "/"), openapi.WithHTTPClient(httpClient))
	if err != nil {
		panic(err)
	}
	return &Client{
		baseURL: baseURL,
		token:   token,
		api:     api,
	}
}

func (c *Client) Heartbeat(ctx context.Context, heartbeat Heartbeat) error {
	body, err := jsonBody(heartbeat)
	if err != nil {
		return err
	}
	res, err := c.api.PostApiDownloaderHeartbeatWithBodyWithResponse(ctx, "application/json", body, bearer(c.token))
	if err != nil {
		return err
	}
	return expectStatus("POST", "/api/downloader/heartbeat", res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) AssignedTasks(ctx context.Context) ([]DownloadTask, error) {
	return c.assignedTasks(ctx, []openapi.GetApiDownloadTasksParamsStatus{
		openapi.GetApiDownloadTasksParamsStatusAssigned,
	})
}

func (c *Client) AssignedControlTasks(ctx context.Context) ([]DownloadTask, error) {
	return c.assignedTasks(ctx, []openapi.GetApiDownloadTasksParamsStatus{
		openapi.GetApiDownloadTasksParamsStatus("pausing"),
		openapi.GetApiDownloadTasksParamsStatus("canceling"),
	})
}

func (c *Client) assignedTasks(ctx context.Context, statuses []openapi.GetApiDownloadTasksParamsStatus) ([]DownloadTask, error) {
	tasks := make([]DownloadTask, 0)
	for _, status := range statuses {
		page := 1
		pageSize := 20
		assignedTo := openapi.GetApiDownloadTasksParamsAssignedToMe
		res, err := c.api.GetApiDownloadTasksWithResponse(ctx, &openapi.GetApiDownloadTasksParams{
			AssignedTo: &assignedTo,
			Status:     &status,
			Page:       &page,
			PageSize:   &pageSize,
		}, bearer(c.token))
		if err != nil {
			return nil, err
		}
		if err := expectStatus("GET", "/api/download-tasks", res.StatusCode(), res.Body, http.StatusOK); err != nil {
			return nil, err
		}
		var result Page[DownloadTask]
		if err := decodeJSON(res.Body, &result); err != nil {
			return nil, fmt.Errorf("GET /api/download-tasks failed: %w", err)
		}
		tasks = append(tasks, result.Items...)
	}
	return tasks, nil
}

func (c *Client) RequestDeviceCode(ctx context.Context) (DeviceCode, error) {
	res, err := c.api.PostApiAuthDeviceCodeWithResponse(ctx, openapi.DeviceCodeRequest{
		ClientId: "zpan-downloader",
		Scope:    "downloader:register",
	})
	if err != nil {
		return DeviceCode{}, err
	}
	if err := expectStatus("POST", "/api/auth/device/code", res.StatusCode(), res.Body, http.StatusOK); err != nil {
		return DeviceCode{}, err
	}
	if res.JSON200 == nil {
		return DeviceCode{}, fmt.Errorf("POST /api/auth/device/code failed: empty response")
	}
	return DeviceCode{
		DeviceCode:              res.JSON200.DeviceCode,
		UserCode:                res.JSON200.UserCode,
		VerificationURI:         res.JSON200.VerificationUri,
		VerificationURIComplete: res.JSON200.VerificationUriComplete,
		ExpiresIn:               res.JSON200.ExpiresIn,
		Interval:                res.JSON200.Interval,
	}, nil
}

func (c *Client) PollDeviceToken(ctx context.Context, deviceCode string) (DeviceToken, error) {
	res, err := c.api.PostApiAuthDeviceTokenWithResponse(ctx, openapi.DeviceTokenRequest{
		GrantType:  "urn:ietf:params:oauth:grant-type:device_code",
		DeviceCode: deviceCode,
		ClientId:   "zpan-downloader",
	})
	if err != nil {
		return DeviceToken{}, err
	}
	if err := expectStatus("POST", "/api/auth/device/token", res.StatusCode(), res.Body, http.StatusOK); err != nil {
		return DeviceToken{}, err
	}
	if res.JSON200 == nil {
		return DeviceToken{}, fmt.Errorf("POST /api/auth/device/token failed: empty response")
	}
	return DeviceToken{
		AccessToken: res.JSON200.AccessToken,
		TokenType:   res.JSON200.TokenType,
		ExpiresIn:   res.JSON200.ExpiresIn,
		Scope:       res.JSON200.Scope,
	}, nil
}

func (c *Client) CreateDownloader(ctx context.Context, accessToken string, req CreateDownloaderRequest) (CreateDownloaderResponse, error) {
	body, err := jsonBody(req)
	if err != nil {
		return CreateDownloaderResponse{}, err
	}
	res, err := c.api.PostApiAdminDownloadersWithBodyWithResponse(ctx, "application/json", body, bearer(accessToken))
	if err != nil {
		return CreateDownloaderResponse{}, err
	}
	if err := expectStatus("POST", "/api/admin/downloaders", res.StatusCode(), res.Body, http.StatusCreated); err != nil {
		return CreateDownloaderResponse{}, err
	}
	var out CreateDownloaderResponse
	if err := decodeJSON(res.Body, &out); err != nil {
		return CreateDownloaderResponse{}, fmt.Errorf("POST /api/admin/downloaders failed: %w", err)
	}
	return out, nil
}

func (c *Client) UpdateTask(ctx context.Context, id string, patch TaskPatch) (DownloadTask, error) {
	body, err := jsonBody(patch)
	if err != nil {
		return DownloadTask{}, err
	}
	res, err := c.api.PatchApiDownloadTasksIdWithBodyWithResponse(ctx, id, "application/json", body, bearer(c.token))
	if err != nil {
		return DownloadTask{}, err
	}
	if err := expectStatus("PATCH", "/api/download-tasks/"+id, res.StatusCode(), res.Body, http.StatusOK); err != nil {
		return DownloadTask{}, err
	}
	var task DownloadTask
	if err := decodeJSON(res.Body, &task); err != nil {
		return DownloadTask{}, fmt.Errorf("PATCH /api/download-tasks/%s failed: %w", id, err)
	}
	return task, nil
}

func (c *Client) CreateObject(ctx context.Context, token string, name string, size int64, parent string) (ObjectDraft, error) {
	return c.createMatter(ctx, token, name, "application/octet-stream", size, parent, dirTypeFile)
}

func (c *Client) CreateFolder(ctx context.Context, token string, name string, parent string) (ObjectDraft, error) {
	return c.createMatter(ctx, token, name, "folder", 0, parent, dirTypeUserFolder)
}

func (c *Client) createMatter(
	ctx context.Context,
	token string,
	name string,
	contentType string,
	size int64,
	parent string,
	dirtype int,
) (ObjectDraft, error) {
	body, err := jsonBody(struct {
		Name       string `json:"name"`
		Type       string `json:"type"`
		Size       int64  `json:"size"`
		Parent     string `json:"parent"`
		Dirtype    int    `json:"dirtype"`
		OnConflict string `json:"onConflict"`
	}{
		Name:       name,
		Type:       contentType,
		Size:       size,
		Parent:     parent,
		Dirtype:    dirtype,
		OnConflict: "rename",
	})
	if err != nil {
		return ObjectDraft{}, err
	}
	res, err := c.api.PostApiObjectsWithBodyWithResponse(ctx, "application/json", body, bearer(token))
	if err != nil {
		return ObjectDraft{}, err
	}
	if err := expectStatus("POST", "/api/objects", res.StatusCode(), res.Body, http.StatusOK, http.StatusCreated); err != nil {
		return ObjectDraft{}, err
	}
	var draft ObjectDraft
	if err := decodeJSON(res.Body, &draft); err != nil {
		return ObjectDraft{}, fmt.Errorf("POST /api/objects failed: %w", err)
	}
	return draft, nil
}

func (c *Client) ConfirmObject(ctx context.Context, token string, id string) error {
	body, err := jsonBody(struct {
		Action     string `json:"action"`
		OnConflict string `json:"onConflict"`
	}{Action: "confirm", OnConflict: "rename"})
	if err != nil {
		return err
	}
	res, err := c.api.PatchApiObjectsIdWithBodyWithResponse(ctx, id, "application/json", body, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("PATCH", "/api/objects/"+id, res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) CreateObjectUploadSession(ctx context.Context, token string, id string, partSize int64) (ObjectUploadSession, error) {
	body, err := jsonBody(struct {
		PartSize int64 `json:"partSize"`
	}{PartSize: partSize})
	if err != nil {
		return ObjectUploadSession{}, err
	}
	res, err := c.api.PostApiObjectsIdUploadsWithBodyWithResponse(ctx, id, "application/json", body, bearer(token))
	if err != nil {
		return ObjectUploadSession{}, err
	}
	if err := expectStatus("POST", "/api/objects/"+id+"/uploads", res.StatusCode(), res.Body, http.StatusCreated); err != nil {
		return ObjectUploadSession{}, err
	}
	if res.JSON201 == nil {
		return ObjectUploadSession{}, fmt.Errorf("POST /api/objects/%s/uploads failed: empty response", id)
	}
	return ObjectUploadSession{
		ID:       res.JSON201.Id,
		ObjectID: res.JSON201.ObjectId,
		UploadID: res.JSON201.UploadId,
		PartSize: int64(res.JSON201.PartSize),
	}, nil
}

func (c *Client) PresignObjectUploadParts(ctx context.Context, token string, id string, sessionID string, partNumbers []int) ([]PresignedObjectUploadPart, error) {
	body, err := jsonBody(struct {
		PartNumbers []int `json:"partNumbers"`
	}{PartNumbers: partNumbers})
	if err != nil {
		return nil, err
	}
	res, err := c.api.PostApiObjectsIdUploadsUploadSessionIdPartsWithBodyWithResponse(ctx, id, sessionID, "application/json", body, bearer(token))
	if err != nil {
		return nil, err
	}
	path := "/api/objects/" + id + "/uploads/" + sessionID + "/parts"
	if err := expectStatus("POST", path, res.StatusCode(), res.Body, http.StatusOK); err != nil {
		return nil, err
	}
	if res.JSON200 == nil {
		return nil, fmt.Errorf("POST %s failed: empty response", path)
	}
	parts := make([]PresignedObjectUploadPart, 0, len(res.JSON200.Parts))
	for _, part := range res.JSON200.Parts {
		parts = append(parts, PresignedObjectUploadPart{PartNumber: part.PartNumber, URL: part.Url})
	}
	return parts, nil
}

func (c *Client) CompleteObjectUploadSession(ctx context.Context, token string, id string, sessionID string, parts []CompletedObjectUploadPart) error {
	body, err := jsonBody(struct {
		Action string                      `json:"action"`
		Parts  []CompletedObjectUploadPart `json:"parts"`
	}{Action: "complete", Parts: parts})
	if err != nil {
		return err
	}
	res, err := c.api.PatchApiObjectsIdUploadsUploadSessionIdWithBodyWithResponse(ctx, id, sessionID, "application/json", body, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("PATCH", "/api/objects/"+id+"/uploads/"+sessionID, res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) AbortObjectUploadSession(ctx context.Context, token string, id string, sessionID string) error {
	body, err := jsonBody(struct {
		Action string `json:"action"`
	}{Action: "abort"})
	if err != nil {
		return err
	}
	res, err := c.api.PatchApiObjectsIdUploadsUploadSessionIdWithBodyWithResponse(ctx, id, sessionID, "application/json", body, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("PATCH", "/api/objects/"+id+"/uploads/"+sessionID, res.StatusCode(), res.Body, http.StatusOK)
}

func jsonBody(value any) (*bytes.Reader, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func decodeJSON(data []byte, out any) error {
	if len(data) == 0 {
		return fmt.Errorf("empty response body")
	}
	return json.Unmarshal(data, out)
}

func bearer(token string) openapi.RequestEditorFn {
	return func(ctx context.Context, req *http.Request) error {
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		return nil
	}
}

func expectStatus(method string, path string, actual int, body []byte, expected ...int) error {
	for _, status := range expected {
		if actual == status {
			return nil
		}
	}
	return fmt.Errorf("%s %s failed: %s: %s", method, path, http.StatusText(actual), responseError(body))
}

func responseError(body []byte) string {
	if len(body) == 0 {
		return "empty response body"
	}
	var problem struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &problem); err == nil && problem.Error != "" {
		return problem.Error
	}
	return strings.TrimSpace(string(body))
}
