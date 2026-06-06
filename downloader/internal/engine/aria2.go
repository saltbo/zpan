package engine

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Braurbeki/arigo"
	"github.com/cenkalti/rpc2"
	"github.com/saltbo/zpan/downloader/internal/client"
)

type Aria2 struct {
	URL        string
	Secret     string
	Dir        string
	StateDir   string
	RetainSeed bool
}

var aria2StatusKeys = []string{
	"gid",
	"status",
	"totalLength",
	"completedLength",
	"downloadSpeed",
	"dir",
	"files",
	"bittorrent",
	"followedBy",
	"following",
	"belongsTo",
	"errorMessage",
	"infoHash",
}

func (a Aria2) Name() string {
	return "aria2"
}

func (a Aria2) Capabilities() []string {
	return []string{"http", "magnet", "torrent"}
}

func (a Aria2) Start(ctx context.Context) (*exec.Cmd, error) {
	path, err := exec.LookPath("aria2c")
	if err != nil {
		return nil, err
	}
	rpcURL, err := parseLocalEngineURL(a.URL, "6800")
	if err != nil {
		return nil, err
	}
	args := []string{
		"--enable-rpc=true",
		"--rpc-listen-all=false",
		"--rpc-listen-port=" + rpcURL.port,
		"--dir=" + a.Dir,
		"--continue=true",
		"--allow-overwrite=true",
		"--auto-file-renaming=false",
	}
	if a.StateDir != "" {
		sessionPath := filepath.Join(a.StateDir, "aria2.session")
		if err := os.MkdirAll(a.StateDir, 0o755); err != nil {
			return nil, err
		}
		file, err := os.OpenFile(sessionPath, os.O_CREATE, 0o644)
		if err != nil {
			return nil, err
		}
		_ = file.Close()
		args = append(args,
			"--input-file="+sessionPath,
			"--save-session="+sessionPath,
			"--save-session-interval=30",
		)
	}
	if a.Secret != "" {
		args = append(args, "--rpc-secret="+a.Secret)
	}
	cmd := exec.Command(path, args...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() { _ = cmd.Wait() }()
	return cmd, nil
}

func (a Aria2) Check(ctx context.Context) error {
	client, err := a.client(ctx)
	if err != nil {
		return err
	}
	defer client.Close()
	version, err := client.GetVersion()
	if err != nil {
		return err
	}
	if version.Version == "" {
		return errors.New("aria2 rpc did not return a version")
	}
	return nil
}

func (a Aria2) SaveSession(ctx context.Context) error {
	client, err := a.client(ctx)
	if err != nil {
		return err
	}
	defer client.Close()
	return client.SaveSession()
}

func (a Aria2) RestoreSeed(ctx context.Context, ref SeedRef) (*Seed, error) {
	aria, err := a.client(ctx)
	if err != nil {
		return nil, err
	}
	defer aria.Close()

	status, ok, err := a.findSeed(ctx, &aria, ref)
	if err != nil || !ok {
		return nil, err
	}
	if int64(status.TotalLength) <= 0 || int64(status.CompletedLength) < int64(status.TotalLength) {
		return nil, nil
	}
	if string(status.Status) == string(arigo.StatusWaiting) {
		_ = aria.Unpause(status.GID)
	}
	path := ref.Path
	if path == "" {
		path = aria2StatusTaskDir(status, filepath.Join(a.Dir, ref.TaskID))
	}
	return &Seed{
		Engine:   "aria2",
		ID:       status.GID,
		InfoHash: strings.ToLower(status.InfoHash),
		Path:     path,
		Snapshot: a.seedSnapshot(status.GID),
		Cleanup:  a.cleanupSeed(status.GID, path),
	}, nil
}

func (a Aria2) Recover(ctx context.Context, task client.DownloadTask) (Result, bool, error) {
	aria, err := a.client(ctx)
	if err == nil {
		defer aria.Close()
		status, ok, findErr := a.findTask(ctx, &aria, task)
		if findErr != nil {
			return Result{}, false, findErr
		}
		if ok && string(status.Status) == string(arigo.StatusCompleted) {
			files, err := a.getAria2Files(ctx, &aria, status.GID)
			if err != nil {
				return Result{}, false, err
			}
			result, err := resultFromAria2Files(task, aria2StatusTaskDir(status, filepath.Join(a.Dir, task.ID)), status.BitTorrent.Info.Name, files)
			return result, err == nil, err
		}
	}
	return recoverFromTaskDir(task, a.Dir)
}

func (a Aria2) Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error) {
	taskDir := filepath.Join(a.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return Result{}, err
	}

	aria, err := a.client(ctx)
	if err != nil {
		return Result{}, err
	}
	defer aria.Close()

	if shouldRecoverExistingAria2Task(task) {
		status, ok, err := a.findTask(ctx, &aria, task)
		if err != nil {
			return Result{}, fmt.Errorf("find aria2 task: %w", err)
		}
		if ok {
			if string(status.Status) == string(arigo.StatusPaused) {
				_ = aria.Unpause(status.GID)
			}
			taskDir = aria2StatusTaskDir(status, taskDir)
			return a.waitResult(ctx, &aria, task, taskDir, status.GID, progress)
		}
	}

	options := &arigo.Options{
		Dir:              taskDir,
		FollowTorrent:    true,
		BTSaveMetadata:   true,
		Continue:         true,
		SeedRatio:        0,
		SeedTime:         0,
		AllowOverwrite:   true,
		AutoFileRenaming: false,
	}
	if a.RetainSeed && task.SourceType != "http" {
		options.SeedTime = 1000000
	}
	if task.Name != "" && task.SourceType == "http" {
		options.GID = aria2TaskGID(task.ID)
		options.Out = task.Name
	}
	gid, err := addAria2Task(ctx, aria, task, options)
	if err != nil {
		status, ok, findErr := a.findTask(ctx, &aria, task)
		if findErr != nil {
			return Result{}, fmt.Errorf("find aria2 task after add failed: %w", findErr)
		}
		if !ok {
			return Result{}, fmt.Errorf("add aria2 uri: %w", err)
		}
		gid.GID = status.GID
		taskDir = aria2StatusTaskDir(status, taskDir)
	}
	result, err := a.waitResult(ctx, &aria, task, taskDir, gid.GID, progress)
	if err != nil {
		if isAria2InfoHashAlreadyRegistered(err) {
			status, ok, findErr := a.findTask(ctx, &aria, task)
			if findErr != nil {
				return Result{}, fmt.Errorf("find aria2 task after infohash conflict: %w", findErr)
			}
			if ok {
				return a.waitResult(ctx, &aria, task, aria2StatusTaskDir(status, taskDir), status.GID, progress)
			}
		}
		return Result{}, fmt.Errorf("wait aria2 result: %w", err)
	}
	return result, nil
}

func shouldRecoverExistingAria2Task(task client.DownloadTask) bool {
	return task.Status == "running" || task.Status == "uploading"
}

func addAria2Task(ctx context.Context, aria *arigo.Client, task client.DownloadTask, options *arigo.Options) (arigo.GID, error) {
	if task.SourceType != "torrent_url" {
		return aria.AddURI(arigo.URIs(task.SourceURI), options)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, task.SourceURI, nil)
	if err != nil {
		return arigo.GID{}, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return arigo.GID{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return arigo.GID{}, fmt.Errorf("fetch torrent file failed: %s", res.Status)
	}
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return arigo.GID{}, err
	}
	return aria.AddTorrent(data, []string{}, options)
}

func (a Aria2) waitResult(ctx context.Context, aria **arigo.Client, task client.DownloadTask, taskDir string, gid string, progress Progress) (Result, error) {
	initialProgress := progress
	if task.SourceType != "http" {
		initialProgress = func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error { return nil }
	}
	primaryGID := gid
	status, err := a.waitAria2(ctx, aria, primaryGID, initialProgress)
	if err != nil {
		_ = (*aria).Remove(primaryGID)
		return Result{}, fmt.Errorf("wait primary gid %s: %w", primaryGID, err)
	}
	resultGID := status.GID
	if len(status.FollowedBy) > 0 {
		childGID := status.FollowedBy[0]
		status, err = a.waitAria2(ctx, aria, childGID, progress)
		if err != nil {
			_ = (*aria).Remove(childGID)
			return Result{}, fmt.Errorf("wait followed gid %s: %w", childGID, err)
		}
		resultGID = status.GID
	}
	files, err := a.getAria2Files(ctx, aria, status.GID)
	if err != nil {
		return Result{}, fmt.Errorf("get files for gid %s: %w", status.GID, err)
	}
	result, err := resultFromAria2Files(task, taskDir, status.BitTorrent.Info.Name, files)
	if err != nil {
		return Result{}, fmt.Errorf("build result from aria2 files: %w", err)
	}
	if a.RetainSeed && task.SourceType != "http" {
		result.Seed = &Seed{
			Engine:   "aria2",
			ID:       resultGID,
			InfoHash: strings.ToLower(status.InfoHash),
			Path:     taskDir,
			Snapshot: a.seedSnapshot(resultGID),
			Cleanup:  a.cleanupSeed(resultGID, taskDir),
		}
		return result, nil
	}
	_ = (*aria).ForceRemove(resultGID)
	_ = (*aria).RemoveDownloadResult(resultGID)
	if primaryGID != resultGID {
		_ = (*aria).ForceRemove(primaryGID)
		_ = (*aria).RemoveDownloadResult(primaryGID)
	}
	return result, nil
}

func (a Aria2) findSeed(ctx context.Context, aria **arigo.Client, ref SeedRef) (arigo.Status, bool, error) {
	if ref.ID != "" {
		status, err := tellAria2Status(*aria, ref.ID)
		if err == nil {
			return status, true, nil
		}
		if isAria2RPCDisconnected(err) {
			if err := a.reconnect(ctx, aria); err != nil {
				return arigo.Status{}, false, err
			}
			status, err = tellAria2Status(*aria, ref.ID)
			if err == nil {
				return status, true, nil
			}
		}
	}
	statuses, err := a.taskStatuses(ctx, aria)
	if err != nil {
		return arigo.Status{}, false, err
	}
	infoHash := strings.ToLower(ref.InfoHash)
	taskDir := filepath.Clean(ref.Path)
	if taskDir == "." || taskDir == string(filepath.Separator) {
		taskDir = filepath.Clean(filepath.Join(a.Dir, ref.TaskID))
	}
	for _, status := range statuses {
		if infoHash != "" && strings.EqualFold(status.InfoHash, infoHash) {
			return status, true, nil
		}
		if taskDir != "" && filepath.Clean(status.Dir) == taskDir {
			return status, true, nil
		}
	}
	return arigo.Status{}, false, nil
}

func (a Aria2) client(ctx context.Context) (*arigo.Client, error) {
	return arigo.DialContext(ctx, a.URL, a.Secret)
}

func (a Aria2) findTask(ctx context.Context, aria **arigo.Client, task client.DownloadTask) (arigo.Status, bool, error) {
	gid := aria2TaskGID(task.ID)
	status, err := tellAria2Status(*aria, gid)
	if err == nil {
		return status, true, nil
	}
	if isAria2RPCDisconnected(err) {
		if err := a.reconnect(ctx, aria); err != nil {
			return arigo.Status{}, false, err
		}
		status, err = tellAria2Status(*aria, gid)
		if err == nil {
			return status, true, nil
		}
	}
	statuses, err := a.taskStatuses(ctx, aria)
	if err != nil {
		return arigo.Status{}, false, fmt.Errorf("list aria2 tasks: %w", err)
	}
	taskDir := filepath.Clean(filepath.Join(a.Dir, task.ID))
	infoHash := aria2TaskInfoHash(task)
	for _, status := range statuses {
		if aria2StatusMatchesTask(status, taskDir, gid, infoHash) {
			return status, true, nil
		}
	}
	return arigo.Status{}, false, nil
}

func (a Aria2) taskStatuses(ctx context.Context, aria **arigo.Client) ([]arigo.Status, error) {
	active, err := (*aria).TellActive(aria2StatusKeys...)
	if err != nil {
		if !isAria2RPCDisconnected(err) {
			return nil, fmt.Errorf("tell active: %w", err)
		}
		if err := a.reconnect(ctx, aria); err != nil {
			return nil, err
		}
		active, err = (*aria).TellActive(aria2StatusKeys...)
		if err != nil {
			return nil, fmt.Errorf("tell active after reconnect: %w", err)
		}
	}
	waiting, err := (*aria).TellWaiting(0, 1000, aria2StatusKeys...)
	if err != nil {
		return nil, fmt.Errorf("tell waiting: %w", err)
	}
	stopped, err := (*aria).TellStopped(0, 1000, aria2StatusKeys...)
	if err != nil {
		return nil, fmt.Errorf("tell stopped: %w", err)
	}
	statuses := make([]arigo.Status, 0, len(active)+len(waiting)+len(stopped))
	statuses = append(statuses, active...)
	statuses = append(statuses, waiting...)
	statuses = append(statuses, stopped...)
	return statuses, nil
}

func aria2TaskGID(taskID string) string {
	sum := sha256.Sum256([]byte(taskID))
	return hex.EncodeToString(sum[:])[:16]
}

func aria2TaskInfoHash(task client.DownloadTask) string {
	if task.Detail != nil && task.Detail.InfoHash != "" {
		return strings.ToLower(task.Detail.InfoHash)
	}
	if task.SourceType != "magnet" {
		return ""
	}
	u, err := url.Parse(task.SourceURI)
	if err != nil {
		return ""
	}
	for _, xt := range u.Query()["xt"] {
		lower := strings.ToLower(xt)
		const prefix = "urn:btih:"
		if !strings.HasPrefix(lower, prefix) {
			continue
		}
		raw := strings.TrimPrefix(lower, prefix)
		if len(raw) == 40 && isHex(raw) {
			return raw
		}
		decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(raw))
		if err == nil && len(decoded) == 20 {
			return hex.EncodeToString(decoded)
		}
	}
	return ""
}

func isHex(value string) bool {
	for _, ch := range value {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') && (ch < 'A' || ch > 'F') {
			return false
		}
	}
	return true
}

func tellAria2Status(aria *arigo.Client, gid string) (arigo.Status, error) {
	return aria.TellStatus(gid, aria2StatusKeys...)
}

func aria2StatusMatchesTask(status arigo.Status, taskDir string, gid string, infoHash string) bool {
	if status.GID == gid || status.Following == gid || status.BelongsTo == gid {
		return true
	}
	if infoHash != "" && strings.EqualFold(status.InfoHash, infoHash) {
		return true
	}
	if filepath.Clean(status.Dir) == taskDir {
		return true
	}
	for _, file := range status.Files {
		if file.Path == "" {
			continue
		}
		abs, _ := downloadedPath(taskDir, file.Path)
		if strings.HasPrefix(filepath.Clean(abs), taskDir+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func aria2StatusTaskDir(status arigo.Status, fallback string) string {
	if status.Dir == "" {
		return fallback
	}
	return filepath.Clean(status.Dir)
}

func isAria2InfoHashAlreadyRegistered(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "InfoHash") && strings.Contains(msg, "already registered")
}

func (a Aria2) seedSnapshot(gid string) func(context.Context) (SeedSnapshot, error) {
	return func(ctx context.Context) (SeedSnapshot, error) {
		aria, err := a.client(ctx)
		if err != nil {
			return SeedSnapshot{}, err
		}
		defer aria.Close()
		status, err := tellAria2Status(aria, gid)
		if err != nil {
			return SeedSnapshot{}, err
		}
		peers := a.getAria2Peers(ctx, &aria, gid)
		total := int64(status.TotalLength)
		var totalPtr *int64
		if total > 0 {
			totalPtr = &total
		}
		detail := aria2Detail(status, peers)
		detail.Phase = "seeding"
		return SeedSnapshot{
			Downloaded: int64(status.CompletedLength),
			Total:      totalPtr,
			Bps:        int64(status.DownloadSpeed),
			Detail:     detail,
		}, nil
	}
}

func (a Aria2) cleanupSeed(gid string, localPath string) func(context.Context) error {
	return func(ctx context.Context) error {
		var errs []error
		aria, err := a.client(ctx)
		if err != nil {
			errs = append(errs, err)
		} else {
			_ = aria.ForceRemove(gid)
			_ = aria.RemoveDownloadResult(gid)
			_ = aria.Close()
		}
		if err := os.RemoveAll(localPath); err != nil {
			errs = append(errs, err)
		}
		return errors.Join(errs...)
	}
}

func (a Aria2) waitAria2(ctx context.Context, aria **arigo.Client, gid string, progress Progress) (arigo.Status, error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return arigo.Status{}, ctx.Err()
		case <-ticker.C:
			status, err := tellAria2Status(*aria, gid)
			if err != nil {
				if isAria2RPCDisconnected(err) {
					if err := a.reconnect(ctx, aria); err != nil {
						return arigo.Status{}, err
					}
					continue
				}
				return arigo.Status{}, err
			}
			total := int64(status.TotalLength)
			completed := int64(status.CompletedLength)
			bps := int64(status.DownloadSpeed)
			var totalPtr *int64
			if total > 0 {
				totalPtr = &total
			}
			peers := a.getAria2Peers(ctx, aria, gid)
			if err := progress(completed, totalPtr, bps, aria2Detail(status, peers)); err != nil {
				_ = (*aria).ForcePause(gid)
				return arigo.Status{}, err
			}
			switch string(status.Status) {
			case "complete", string(arigo.StatusCompleted):
				if len(status.FollowedBy) == 0 && !hasAria2LocalFile(status.Files) {
					continue
				}
				return status, nil
			case string(arigo.StatusActive):
				if total > 0 && completed >= total && hasAria2LocalFile(status.Files) {
					return status, nil
				}
			case string(arigo.StatusError), string(arigo.StatusRemoved):
				if status.ErrorMessage != "" {
					return arigo.Status{}, errors.New(status.ErrorMessage)
				}
				return arigo.Status{}, fmt.Errorf("aria2 download ended with status %s", status.Status)
			}
		}
	}
}

func (a Aria2) getAria2Peers(ctx context.Context, aria **arigo.Client, gid string) []arigo.Peer {
	peers, err := (*aria).GetPeers(gid)
	if err == nil {
		return peers
	}
	if !isAria2RPCDisconnected(err) {
		return nil
	}
	if err := a.reconnect(ctx, aria); err != nil {
		return nil
	}
	peers, err = (*aria).GetPeers(gid)
	if err != nil {
		return nil
	}
	return peers
}

func (a Aria2) getAria2Files(ctx context.Context, aria **arigo.Client, gid string) ([]arigo.File, error) {
	files, err := (*aria).GetFiles(gid)
	if err == nil {
		return files, nil
	}
	if !isAria2RPCDisconnected(err) {
		return nil, err
	}
	if err := a.reconnect(ctx, aria); err != nil {
		return nil, err
	}
	return (*aria).GetFiles(gid)
}

func (a Aria2) reconnect(ctx context.Context, aria **arigo.Client) error {
	_ = (*aria).Close()
	next, err := a.client(ctx)
	if err != nil {
		return err
	}
	*aria = next
	return nil
}

func isAria2RPCDisconnected(err error) bool {
	return errors.Is(err, rpc2.ErrShutdown) || errors.Is(err, io.ErrClosedPipe) || strings.Contains(err.Error(), "connection is shut down")
}

func aria2Detail(status arigo.Status, peers []arigo.Peer) *client.DownloadTaskDetail {
	connections := int64(status.Connections)
	seeders := int64(status.NumSeeders)
	peerCount := int64(len(peers))
	leechers := aria2Leechers(peers)
	uploaded := int64(status.UploadLength)
	uploadBps := int64(status.UploadSpeed)
	detail := &client.DownloadTaskDetail{
		Engine:            "aria2",
		Phase:             aria2Phase(string(status.Status), status.FollowedBy),
		EngineState:       string(status.Status),
		ETASeconds:        aria2ETA(status),
		Connections:       &connections,
		InfoHash:          status.InfoHash,
		TorrentName:       status.BitTorrent.Info.Name,
		Seeders:           &seeders,
		Leechers:          leechers,
		Peers:             &peerCount,
		PeerUploadedBytes: &uploaded,
		PeerUploadBps:     &uploadBps,
		Trackers:          aria2Trackers(status.BitTorrent.AnnounceList),
		PeerSamples:       aria2Peers(peers),
		Files:             aria2Files(status.Dir, status.Files),
	}
	if status.ErrorMessage != "" {
		detail.Message = status.ErrorMessage
	}
	return detail
}

func aria2ETA(status arigo.Status) *int64 {
	total := int64(status.TotalLength)
	completed := int64(status.CompletedLength)
	bps := int64(status.DownloadSpeed)
	if total <= 0 || completed >= total || bps <= 0 {
		return nil
	}
	remaining := total - completed
	eta := (remaining + bps - 1) / bps
	return &eta
}

func aria2Phase(state string, followedBy []string) string {
	switch state {
	case string(arigo.StatusWaiting):
		if len(followedBy) > 0 {
			return "metadata"
		}
		return "downloading"
	case string(arigo.StatusActive):
		return "downloading"
	case "complete", string(arigo.StatusCompleted):
		return "completed"
	case string(arigo.StatusError), string(arigo.StatusRemoved):
		return "error"
	default:
		return "downloading"
	}
}

func aria2Trackers(announceList [][]string) []client.DownloadTaskTracker {
	trackers := make([]client.DownloadTaskTracker, 0, 20)
	seen := map[string]struct{}{}
	for _, tier := range announceList {
		for _, url := range tier {
			if url == "" {
				continue
			}
			if _, exists := seen[url]; exists {
				continue
			}
			seen[url] = struct{}{}
			trackers = append(trackers, client.DownloadTaskTracker{
				URL:     url,
				Status:  "announce",
				Message: "aria2 exposes announce URLs only",
			})
			if len(trackers) >= 20 {
				return trackers
			}
		}
	}
	return trackers
}

func aria2Leechers(peers []arigo.Peer) *int64 {
	if len(peers) == 0 {
		return nil
	}
	var count int64
	for _, peer := range peers {
		if !peer.Seeder {
			count++
		}
	}
	return &count
}

func aria2Peers(peers []arigo.Peer) []client.DownloadTaskPeer {
	out := make([]client.DownloadTaskPeer, 0, min(len(peers), 20))
	for _, peer := range peers {
		if peer.IP == "" {
			continue
		}
		down := int64(peer.DownloadSpeed)
		up := int64(peer.UploadSpeed)
		out = append(out, client.DownloadTaskPeer{
			Address:     fmt.Sprintf("%s:%d", peer.IP, peer.Port),
			DownloadBps: &down,
			UploadBps:   &up,
		})
		if len(out) >= 20 {
			break
		}
	}
	return out
}

func aria2Files(baseDir string, files []arigo.File) []client.DownloadTaskFile {
	out := make([]client.DownloadTaskFile, 0, min(len(files), 50))
	for _, file := range files {
		if file.Path == "" || isAria2MetadataPath(file.Path) {
			continue
		}
		_, rel := downloadedPath(baseDir, file.Path)
		size := int64(file.Length)
		completed := int64(file.CompletedLength)
		selected := file.Selected
		out = append(out, client.DownloadTaskFile{
			Path:           filepath.ToSlash(rel),
			Size:           size,
			CompletedBytes: &completed,
			Selected:       &selected,
		})
		if len(out) >= 50 {
			break
		}
	}
	return out
}

func hasAria2LocalFile(files []arigo.File) bool {
	for _, file := range files {
		if file.Path != "" && !isAria2MetadataPath(file.Path) {
			return true
		}
	}
	return false
}

func resultFromAria2Files(task client.DownloadTask, taskDir string, fallbackName string, files []arigo.File) (Result, error) {
	downloaded := make([]downloadedFile, 0, len(files))
	for _, file := range files {
		if file.Selected && file.Length > 0 && !isDownloadSidecarPath(file.Path) {
			abs, rel := downloadedPath(taskDir, file.Path)
			downloaded = append(downloaded, downloadedFile{path: abs, relativePath: rel})
		}
	}
	if len(downloaded) == 0 {
		return resultFromPath(task, taskDir, fallbackName)
	}
	return resultFromDownloadedFiles(task, taskDir, fallbackName, downloaded)
}
