package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/saltbo/zpan/cmd/internal/openapi"
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
	ID     string             `json:"id"`
	Spec   DownloadTaskSpec   `json:"spec"`
	Status DownloadTaskStatus `json:"status"`
}

func (t DownloadTask) SourceType() string {
	return t.Spec.Source.Type
}

func (t DownloadTask) SourceURI() string {
	return t.Spec.Source.URI
}

func (t DownloadTask) Name() string {
	return t.Spec.Destination.Name
}

func (t DownloadTask) TargetFolder() string {
	return t.Spec.Destination.Folder
}

func (t DownloadTask) Category() string {
	return t.Spec.Labels.Category
}

func (t DownloadTask) Tags() []string {
	return t.Spec.Labels.Tags
}

func (t DownloadTask) State() string {
	return t.Status.State
}

func (t DownloadTask) Attempt() int {
	return t.Status.Attempt
}

func (t DownloadTask) Runtime() *DownloadTaskRuntime {
	return t.Status.Runtime
}

func (t DownloadTask) UploadToken() string {
	if t.Status.Assignment == nil {
		return ""
	}
	return t.Status.Assignment.UploadToken
}

type DownloadTaskSpec struct {
	Source      DownloadTaskSource      `json:"source"`
	Destination DownloadTaskDestination `json:"destination"`
	Labels      DownloadTaskLabels      `json:"labels"`
}

type DownloadTaskSource struct {
	Type string `json:"type"`
	URI  string `json:"uri"`
}

type DownloadTaskDestination struct {
	Folder string `json:"folder"`
	Name   string `json:"name"`
}

type DownloadTaskLabels struct {
	Category string   `json:"category"`
	Tags     []string `json:"tags"`
}

type DownloadTaskStatus struct {
	State      string                  `json:"state"`
	Attempt    int                     `json:"attempt"`
	Assignment *DownloadTaskAssignment `json:"assignment"`
	Progress   DownloadTaskProgress    `json:"progress"`
	Runtime    *DownloadTaskRuntime    `json:"runtime"`
	Output     *DownloadTaskOutput     `json:"output"`
	Error      *DownloadTaskError      `json:"error"`
}

type DownloadTaskAssignment struct {
	DownloaderID string `json:"downloaderId"`
	AssignedAt   string `json:"assignedAt"`
	UploadToken  string `json:"uploadToken,omitempty"`
}

type DownloadTaskOutput struct {
	ObjectID string `json:"objectId"`
}

type DownloadTaskError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type DownloadTaskProgress struct {
	Download DownloadTaskTransferProgress `json:"download"`
	Upload   DownloadTaskTransferProgress `json:"upload"`
}

type DownloadTaskTransferProgress struct {
	Bytes          int64  `json:"bytes"`
	TotalBytes     *int64 `json:"totalBytes"`
	BytesPerSecond int64  `json:"bytesPerSecond"`
}

type DownloadTaskProgressPatch struct {
	Download *DownloadTaskTransferProgress `json:"download,omitempty"`
	Upload   *DownloadTaskTransferProgress `json:"upload,omitempty"`
}

type DownloadTaskRuntime struct {
	Engine      string                      `json:"engine,omitempty"`
	Phase       string                      `json:"phase,omitempty"`
	State       string                      `json:"state,omitempty"`
	Message     string                      `json:"message,omitempty"`
	UpdatedAt   string                      `json:"updatedAt,omitempty"`
	Progress    *DownloadTaskProgress       `json:"progress,omitempty"`
	ETASeconds  *int64                      `json:"etaSeconds,omitempty"`
	Connections *int64                      `json:"connections,omitempty"`
	Torrent     *DownloadTaskTorrentRuntime `json:"torrent,omitempty"`
	Seeding     *DownloadTaskSeedingRuntime `json:"seeding,omitempty"`
	Trackers    []DownloadTaskTracker       `json:"trackers,omitempty"`
	Peers       []DownloadTaskPeer          `json:"peers,omitempty"`
	Files       []DownloadTaskFile          `json:"files,omitempty"`
}

type DownloadTaskTorrentRuntime struct {
	InfoHash string `json:"infoHash,omitempty"`
	Name     string `json:"name,omitempty"`
	Seeders  *int64 `json:"seeders,omitempty"`
	Leechers *int64 `json:"leechers,omitempty"`
	Peers    *int64 `json:"peers,omitempty"`
}

type DownloadTaskSeedingRuntime struct {
	Enabled              *bool    `json:"enabled,omitempty"`
	Active               *bool    `json:"active,omitempty"`
	UploadedBytes        *int64   `json:"uploadedBytes,omitempty"`
	UploadBytesPerSecond *int64   `json:"uploadBytesPerSecond,omitempty"`
	Ratio                *float64 `json:"ratio,omitempty"`
	StartedAt            string   `json:"startedAt,omitempty"`
	ExpiresAt            string   `json:"expiresAt,omitempty"`
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
	CountryCode string   `json:"countryCode,omitempty"`
	RegionCode  string   `json:"regionCode,omitempty"`
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
	Status         string                     `json:"status,omitempty"`
	Progress       *DownloadTaskProgressPatch `json:"progress,omitempty"`
	ErrorMessage   *string                    `json:"errorMessage,omitempty"`
	ResultObjectID *string                    `json:"resultObjectId,omitempty"`
	Runtime        *DownloadTaskRuntime       `json:"runtime,omitempty"`
}

func (p TaskPatch) State() string {
	return p.Status
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

func New(baseURL, token string) (*Client, error) {
	httpClient := &http.Client{Timeout: 60 * time.Second}
	api, err := openapi.NewClientWithResponses(strings.TrimRight(baseURL, "/"), openapi.WithHTTPClient(httpClient))
	if err != nil {
		return nil, err
	}
	return &Client{
		baseURL: baseURL,
		token:   token,
		api:     api,
	}, nil
}

func (c *Client) Heartbeat(ctx context.Context, heartbeat Heartbeat) error {
	res, err := c.api.RecordDownloaderHeartbeatWithResponse(ctx, heartbeatRequestBody(heartbeat), bearer(c.token))
	if err != nil {
		return err
	}
	return expectStatus("POST", "/api/downloads/downloaders/me/heartbeats", res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) AssignedTasks(ctx context.Context) ([]DownloadTask, error) {
	return c.assignedTasks(ctx, []openapi.ListDownloadTasksParamsStatus{
		openapi.ListDownloadTasksParamsStatusAssigned,
		openapi.ListDownloadTasksParamsStatusDownloading,
		openapi.ListDownloadTasksParamsStatusInterrupted,
		openapi.ListDownloadTasksParamsStatusUploading,
	})
}

func (c *Client) AssignedControlTasks(ctx context.Context) ([]DownloadTask, error) {
	return c.assignedTasks(ctx, []openapi.ListDownloadTasksParamsStatus{
		openapi.ListDownloadTasksParamsStatus("pausing"),
		openapi.ListDownloadTasksParamsStatus("canceling"),
	})
}

func (c *Client) assignedTasks(ctx context.Context, statuses []openapi.ListDownloadTasksParamsStatus) ([]DownloadTask, error) {
	tasks := make([]DownloadTask, 0)
	for _, status := range statuses {
		page := 1
		pageSize := 20
		assignedTo := openapi.Me
		res, err := c.api.ListDownloadTasksWithResponse(ctx, &openapi.ListDownloadTasksParams{
			AssignedTo: &assignedTo,
			Status:     &status,
			Page:       &page,
			PageSize:   &pageSize,
		}, bearer(c.token))
		if err != nil {
			return nil, err
		}
		if err := expectStatus("GET", "/api/downloads/tasks", res.StatusCode(), res.Body, http.StatusOK); err != nil {
			return nil, err
		}
		if res.JSON200 == nil {
			return nil, fmt.Errorf("GET /api/downloads/tasks failed: empty response")
		}
		for _, item := range res.JSON200.Items {
			task, err := downloadTaskFromOpenAPI(item)
			if err != nil {
				return nil, fmt.Errorf("GET /api/downloads/tasks failed: %w", err)
			}
			tasks = append(tasks, task)
		}
	}
	return tasks, nil
}

func (c *Client) RequestDeviceCode(ctx context.Context) (DeviceCode, error) {
	scope := "downloader:register"
	res, err := c.api.PostApiAuthDeviceCodeWithResponse(ctx, openapi.PostApiAuthDeviceCodeJSONRequestBody{
		ClientId: "zpan-cli",
		Scope:    &scope,
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
		DeviceCode:              derefString(res.JSON200.DeviceCode),
		UserCode:                derefString(res.JSON200.UserCode),
		VerificationURI:         derefString(res.JSON200.VerificationUri),
		VerificationURIComplete: derefString(res.JSON200.VerificationUriComplete),
		ExpiresIn:               derefFloatToInt(res.JSON200.ExpiresIn),
		Interval:                derefFloatToInt(res.JSON200.Interval),
	}, nil
}

func (c *Client) PollDeviceToken(ctx context.Context, deviceCode string) (DeviceToken, error) {
	res, err := c.api.PostApiAuthDeviceTokenWithResponse(ctx, openapi.PostApiAuthDeviceTokenJSONRequestBody{
		GrantType:  "urn:ietf:params:oauth:grant-type:device_code",
		DeviceCode: deviceCode,
		ClientId:   "zpan-cli",
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
		Scope:       derefString(res.JSON200.Scope),
	}, nil
}

func (c *Client) CreateDownloader(ctx context.Context, accessToken string, req CreateDownloaderRequest) (CreateDownloaderResponse, error) {
	res, err := c.api.CreateDownloaderWithResponse(ctx, createDownloaderRequestBody(req), bearer(accessToken))
	if err != nil {
		return CreateDownloaderResponse{}, err
	}
	if err := expectStatus("POST", "/api/downloads/downloaders", res.StatusCode(), res.Body, http.StatusCreated); err != nil {
		return CreateDownloaderResponse{}, err
	}
	if res.JSON201 == nil {
		return CreateDownloaderResponse{}, fmt.Errorf("POST /api/admin/downloaders failed: empty response")
	}
	out := CreateDownloaderResponse{Token: res.JSON201.Token}
	out.Downloader.ID = res.JSON201.Downloader.Id
	return out, nil
}

func heartbeatRequestBody(heartbeat Heartbeat) openapi.RecordDownloaderHeartbeatJSONRequestBody {
	return openapi.RecordDownloaderHeartbeatJSONRequestBody{
		Arch:               heartbeat.Arch,
		Capabilities:       heartbeat.Capabilities,
		CurrentTasks:       heartbeat.CurrentTasks,
		DownloadBps:        &heartbeat.DownloadBps,
		Engine:             openapi.RecordDownloaderHeartbeatJSONBodyEngine(heartbeat.Engine),
		FreeDiskBytes:      &heartbeat.FreeDiskBytes,
		Hostname:           heartbeat.Hostname,
		MaxConcurrentTasks: heartbeat.MaxConcurrentTasks,
		Platform:           heartbeat.Platform,
		UploadBps:          &heartbeat.UploadBps,
		Version:            heartbeat.Version,
	}
}

func createDownloaderRequestBody(req CreateDownloaderRequest) openapi.CreateDownloaderJSONRequestBody {
	return openapi.CreateDownloaderJSONRequestBody{
		Name: req.Name,
		Heartbeat: struct {
			Arch               string                                          `json:"arch"`
			Capabilities       []string                                        `json:"capabilities"`
			CurrentTasks       int                                             `json:"currentTasks"`
			DownloadBps        *int64                                          `json:"downloadBps,omitempty"`
			Engine             openapi.CreateDownloaderJSONBodyHeartbeatEngine `json:"engine"`
			FreeDiskBytes      *int64                                          `json:"freeDiskBytes,omitempty"`
			Hostname           string                                          `json:"hostname"`
			MaxConcurrentTasks int                                             `json:"maxConcurrentTasks"`
			Platform           string                                          `json:"platform"`
			UploadBps          *int64                                          `json:"uploadBps,omitempty"`
			Version            string                                          `json:"version"`
		}{
			Arch:               req.Heartbeat.Arch,
			Capabilities:       req.Heartbeat.Capabilities,
			CurrentTasks:       req.Heartbeat.CurrentTasks,
			DownloadBps:        &req.Heartbeat.DownloadBps,
			Engine:             openapi.CreateDownloaderJSONBodyHeartbeatEngine(req.Heartbeat.Engine),
			FreeDiskBytes:      &req.Heartbeat.FreeDiskBytes,
			Hostname:           req.Heartbeat.Hostname,
			MaxConcurrentTasks: req.Heartbeat.MaxConcurrentTasks,
			Platform:           req.Heartbeat.Platform,
			UploadBps:          &req.Heartbeat.UploadBps,
			Version:            req.Heartbeat.Version,
		},
	}
}

func taskPatchRequestBody(patch TaskPatch) (openapi.UpdateDownloadTaskJSONRequestBody, error) {
	data, err := json.Marshal(patch)
	if err != nil {
		return openapi.UpdateDownloadTaskJSONRequestBody{}, err
	}
	var body openapi.UpdateDownloadTaskJSONRequestBody
	if err := json.Unmarshal(data, &body); err != nil {
		return openapi.UpdateDownloadTaskJSONRequestBody{}, err
	}
	return body, nil
}

func downloadTaskFromOpenAPI(value any) (DownloadTask, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return DownloadTask{}, err
	}
	var task DownloadTask
	if err := json.Unmarshal(data, &task); err != nil {
		return DownloadTask{}, err
	}
	return task, nil
}

func (c *Client) UpdateTask(ctx context.Context, id string, patch TaskPatch) (DownloadTask, error) {
	body, err := taskPatchRequestBody(patch)
	if err != nil {
		return DownloadTask{}, err
	}
	res, err := c.api.UpdateDownloadTaskWithResponse(ctx, id, body, bearer(c.token))
	if err != nil {
		return DownloadTask{}, err
	}
	if err := expectStatus("PATCH", "/api/downloads/tasks/"+id, res.StatusCode(), res.Body, http.StatusOK); err != nil {
		return DownloadTask{}, err
	}
	if res.JSON200 == nil {
		return DownloadTask{}, fmt.Errorf("PATCH /api/downloads/tasks/%s failed: empty response", id)
	}
	task, err := downloadTaskFromOpenAPI(*res.JSON200)
	if err != nil {
		return DownloadTask{}, fmt.Errorf("PATCH /api/downloads/tasks/%s failed: %w", id, err)
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
	sizeInt := int(size)
	onConflict := openapi.CreateObjectJSONBodyOnConflictRename
	res, err := c.api.CreateObjectWithResponse(ctx, openapi.CreateObjectJSONRequestBody{
		Name:       name,
		Type:       contentType,
		Size:       &sizeInt,
		Parent:     &parent,
		Dirtype:    &dirtype,
		OnConflict: &onConflict,
	}, bearer(token))
	if err != nil {
		return ObjectDraft{}, err
	}
	if err := expectStatus("POST", "/api/objects", res.StatusCode(), res.Body, http.StatusOK, http.StatusCreated); err != nil {
		return ObjectDraft{}, err
	}
	if res.JSON201 != nil {
		return ObjectDraft{
			ID:                 res.JSON201.Id,
			Name:               res.JSON201.Name,
			UploadURL:          derefString(res.JSON201.UploadUrl),
			ContentDisposition: derefString(res.JSON201.ContentDisposition),
		}, nil
	}
	return ObjectDraft{}, fmt.Errorf("POST /api/objects failed: empty response")
}

func (c *Client) ConfirmObject(ctx context.Context, token string, id string) error {
	onConflict := openapi.SetObjectStatusJSONBodyOnConflictRename
	res, err := c.api.SetObjectStatusWithResponse(ctx, id, openapi.SetObjectStatusJSONRequestBody{
		Status:     openapi.SetObjectStatusJSONBodyStatusActive,
		OnConflict: &onConflict,
	}, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("PUT", "/api/objects/"+id+"/status", res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) CreateObjectUploadSession(ctx context.Context, token string, id string, partSize int64) (ObjectUploadSession, error) {
	partSizeInt := int(partSize)
	res, err := c.api.CreateObjectUploadSessionWithResponse(ctx, id, openapi.CreateObjectUploadSessionJSONRequestBody{
		PartSize: &partSizeInt,
	}, bearer(token))
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
	res, err := c.api.PresignObjectUploadPartsWithResponse(ctx, id, sessionID, openapi.PresignObjectUploadPartsJSONRequestBody{
		PartNumbers: partNumbers,
	}, bearer(token))
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
	body := openapi.CompleteObjectUploadJSONRequestBody{
		Status: openapi.CompleteObjectUploadJSONBodyStatusCompleted,
		Parts: make([]struct {
			Etag       string `json:"etag"`
			PartNumber int    `json:"partNumber"`
		}, 0, len(parts)),
	}
	for _, part := range parts {
		body.Parts = append(body.Parts, struct {
			Etag       string `json:"etag"`
			PartNumber int    `json:"partNumber"`
		}{Etag: part.ETag, PartNumber: part.PartNumber})
	}
	res, err := c.api.CompleteObjectUploadWithResponse(ctx, id, sessionID, body, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("PUT", "/api/objects/"+id+"/uploads/"+sessionID+"/status", res.StatusCode(), res.Body, http.StatusOK)
}

func (c *Client) AbortObjectUploadSession(ctx context.Context, token string, id string, sessionID string) error {
	res, err := c.api.AbortObjectUploadWithResponse(ctx, id, sessionID, bearer(token))
	if err != nil {
		return err
	}
	return expectStatus("DELETE", "/api/objects/"+id+"/uploads/"+sessionID, res.StatusCode(), res.Body, http.StatusOK)
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// better-auth's device/code schema types expires_in/interval as `number` and
// leaves them optional, so the generated client surfaces them as *float32.
// They are always whole-second integers at runtime.
func derefFloatToInt(value *float32) int {
	if value == nil {
		return 0
	}
	return int(*value)
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
