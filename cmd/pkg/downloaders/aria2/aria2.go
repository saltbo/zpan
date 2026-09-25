package aria2

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Braurbeki/arigo"
	"github.com/cenkalti/rpc2"
	"github.com/saltbo/zpan/internal/downloader"
	"github.com/saltbo/zpan/pkg/downloaders/core"
	"github.com/saltbo/zpan/pkg/downloaders/httpdl"
	"github.com/saltbo/zpan/pkg/geoip"
	"github.com/saltbo/zpan/pkg/system"
)

func init() {
	downloader.Register("aria2", false, configured, New)
}

func configured(cfg downloader.Config) bool {
	return cfg.Aria2.Configured
}

func New(cfg downloader.Config) (downloader.Downloader, error) {
	return &Aria2{
		URL:                    cfg.Aria2.URL,
		Secret:                 cfg.Aria2.Secret,
		Dir:                    cfg.DownloadDir,
		StateDir:               cfg.StateDir,
		ListenPort:             cfg.BTListenPort,
		MaxConcurrentDownloads: cfg.MaxConcurrentDownloads,
		RetainSeed:             cfg.SeedEnabled,
		SeedDuration:           cfg.SeedDuration,
		SeedRatio:              cfg.SeedRatio,
		BtTrackers:             cfg.Aria2.BtTrackers,
		Managed:                !cfg.Aria2.Configured && (cfg.Engine == "" || cfg.Engine == "auto" || cfg.Engine == "aria2"),
		GeoIP:                  cfg.GeoIP,
	}, nil
}

type Aria2 struct {
	URL                    string
	Secret                 string
	Dir                    string
	StateDir               string
	ListenPort             int
	MaxConcurrentDownloads int
	RetainSeed             bool
	SeedDuration           time.Duration
	SeedRatio              float64
	// BtTrackers is the comma-separated --bt-tracker list. When empty, startup
	// uses the shared downloader tracker list with a logged fallback.
	BtTrackers string
	Managed    bool
	GeoIP      geoip.Resolver
	cmd        *exec.Cmd
}

// aria2 measures --seed-time in minutes. A zero seed duration means "seed
// indefinitely", which we approximate with a very large value rather than 0
// (aria2 treats --seed-time=0 as "do not seed at all").
const aria2SeedForeverMinutes = 1000000

func aria2SeedTimeMinutes(d time.Duration) uint {
	if d <= 0 {
		return aria2SeedForeverMinutes
	}
	minutes := uint(d.Minutes())
	if minutes == 0 {
		return 1
	}
	return minutes
}

var aria2StatusKeys = []string{
	"gid",
	"status",
	"totalLength",
	"completedLength",
	"downloadSpeed",
	"uploadLength",
	"uploadSpeed",
	"connections",
	"numSeeders",
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

func (a Aria2) Capabilities() downloader.Capabilities {
	return downloader.Capabilities{SourceTypes: []string{"magnet", "torrent", "torrent_url"}}
}

func (a *Aria2) Start(ctx context.Context) error {
	if !a.Managed {
		return nil
	}
	path, err := exec.LookPath("aria2c")
	if err != nil {
		return err
	}
	rpcURL, err := system.ParseLocalEngineURL(a.URL, "6800")
	if err != nil {
		return err
	}
	args, err := a.startArgs(rpcURL.Port)
	if err != nil {
		return err
	}
	cmd := exec.Command(path, args...)
	system.ConfigureProcess(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	a.cmd = cmd
	return nil
}

func (a *Aria2) Stop(ctx context.Context) error {
	if a.cmd == nil {
		return nil
	}
	var errs []error
	if err := a.SaveSession(ctx); err != nil {
		errs = append(errs, fmt.Errorf("save aria2 session: %w", err))
	}
	if a.cmd.Process != nil {
		if err := a.cmd.Process.Kill(); err != nil {
			errs = append(errs, fmt.Errorf("kill aria2 process: %w", err))
		}
	}
	done := make(chan error, 1)
	go func() { done <- a.cmd.Wait() }()
	select {
	case <-done:
	case <-ctx.Done():
		errs = append(errs, ctx.Err())
	}
	a.cmd = nil
	return errors.Join(errs...)
}

func (a Aria2) startArgs(rpcPort string) ([]string, error) {
	trackers := core.BTTrackers(a.BtTrackers)
	args := []string{
		"--enable-rpc=true",
		"--rpc-listen-all=false",
		"--rpc-listen-port=" + rpcPort,
		"--dir=" + a.Dir,
		"--continue=true",
		"--allow-overwrite=true",
		"--auto-file-renaming=false",
		"--listen-port=" + listenPortString(a.ListenPort),
		// Magnets often ship dead trackers; broaden peer discovery so metadata
		// can still be fetched (DHT + peer exchange + a curated live tracker list).
		"--enable-dht=true",
		"--enable-peer-exchange=true",
		"--bt-load-saved-metadata=true",
		"--bt-tracker=" + trackers,
	}
	if a.MaxConcurrentDownloads > 0 {
		// Retained seeds count as active downloads in aria2, so this budget must
		// exceed the worker's download concurrency or seeding would starve new
		// downloads. The worker caps real download concurrency itself.
		args = append(args, "--max-concurrent-downloads="+strconv.Itoa(a.MaxConcurrentDownloads))
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
			"--save-session="+sessionPath,
			"--save-session-interval=30",
			"--force-save=true",
			// Persist the DHT routing table so peer discovery is warm on restart
			// instead of re-bootstrapping cold (which leaves magnets stuck).
			"--dht-file-path="+filepath.Join(a.StateDir, "dht.dat"),
		)
	}
	if a.Secret != "" {
		args = append(args, "--rpc-secret="+a.Secret)
	}
	return args, nil
}

func listenPortString(port int) string {
	if port == 0 {
		return "6881"
	}
	return strconv.Itoa(port)
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

func (a Aria2) ResetTask(ctx context.Context, task downloader.DownloadTask) error {
	if task.SourceType() == "http" {
		return httpdl.HTTP{Dir: a.Dir}.ResetTask(ctx, task)
	}
	aria, err := a.client(ctx)
	if err != nil {
		return err
	}
	defer aria.Close()
	taskDir := filepath.Clean(filepath.Join(a.Dir, task.ID))
	statuses, err := a.taskStatuses(ctx, &aria)
	if err != nil {
		return err
	}
	var resetErrs []error
	for _, status := range statuses {
		if !aria2StatusBelongsToTask(status, taskDir, aria2TaskGID(task.ID)) {
			continue
		}
		removeActive, removeResult := aria2ResetOperations(status)
		if removeActive {
			err := aria.ForceRemove(status.GID)
			if err != nil && !isAria2DownloadNotFound(err) {
				resetErrs = append(resetErrs, fmt.Errorf("force remove aria2 gid %s: %w", status.GID, err))
			}
		}
		if removeResult {
			err := aria.RemoveDownloadResult(status.GID)
			if err != nil && !isAria2DownloadNotFound(err) {
				resetErrs = append(resetErrs, fmt.Errorf("remove aria2 result %s: %w", status.GID, err))
			}
		}
	}
	if err := os.RemoveAll(taskDir); err != nil {
		resetErrs = append(resetErrs, fmt.Errorf("remove task dir %s: %w", taskDir, err))
	}
	return errors.Join(resetErrs...)
}

func aria2ResetOperations(status arigo.Status) (removeActive bool, removeResult bool) {
	switch string(status.Status) {
	case string(arigo.StatusCompleted), string(arigo.StatusError), string(arigo.StatusRemoved), "complete":
		return false, true
	case string(arigo.StatusActive), string(arigo.StatusWaiting), string(arigo.StatusPaused):
		return true, true
	default:
		return true, true
	}
}

func isAria2DownloadNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "download") && strings.Contains(msg, "not found")
}

// isAria2GIDNotFound reports whether a status lookup failed because aria2 has no
// record of the GID — the message aria2 returns from tellStatus is
// "GID <gid> is not found", which lacks the word "download" that
// isAria2DownloadNotFound looks for. This happens when aria2 restarts mid-task
// and re-creates the download under a fresh GID.
func isAria2GIDNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") &&
		(strings.Contains(msg, "gid") || strings.Contains(msg, "download"))
}

func (a Aria2) SaveSession(ctx context.Context) error {
	client, err := a.client(ctx)
	if err != nil {
		return err
	}
	defer client.Close()
	return client.SaveSession()
}

func (a Aria2) RestoreSeed(ctx context.Context, ref downloader.SeedRef) (*downloader.Seed, error) {
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
	return &downloader.Seed{
		Engine:   "aria2",
		ID:       status.GID,
		InfoHash: strings.ToLower(status.InfoHash),
		Path:     path,
		Snapshot: a.seedSnapshot(status.GID),
		Cleanup:  a.cleanupSeed(status.GID, path),
	}, nil
}

func (a Aria2) ListSeeds(ctx context.Context) ([]downloader.Seed, error) {
	aria, err := a.client(ctx)
	if err != nil {
		return nil, err
	}
	defer aria.Close()
	statuses, err := a.taskStatuses(ctx, &aria)
	if err != nil {
		return nil, err
	}
	var seeds []downloader.Seed
	for _, status := range statuses {
		if !isAria2SeedStatus(status) {
			continue
		}
		path := aria2StatusTaskDir(status, "")
		if path == "" {
			continue
		}
		seeds = append(seeds, downloader.Seed{
			Engine:   "aria2",
			ID:       status.GID,
			InfoHash: strings.ToLower(status.InfoHash),
			Path:     path,
			Snapshot: a.seedSnapshot(status.GID),
			Cleanup:  a.cleanupSeed(status.GID, path),
		})
	}
	return seeds, nil
}

func (a Aria2) InspectTask(ctx context.Context, task downloader.DownloadTask) (downloader.TaskSnapshot, bool, error) {
	if task.SourceType() == "http" {
		return httpdl.HTTP{Dir: a.Dir}.InspectTask(ctx, task)
	}
	aria, err := a.client(ctx)
	if err != nil {
		return downloader.TaskSnapshot{}, false, err
	}
	defer aria.Close()
	status, ok, err := a.findTask(ctx, &aria, task)
	if err != nil || !ok {
		return downloader.TaskSnapshot{}, ok, err
	}
	return a.snapshotTask(ctx, &aria, task, status)
}

func (a Aria2) Download(ctx context.Context, task downloader.DownloadTask, progress downloader.ProgressReporter) (downloader.Result, error) {
	if task.SourceType() == "http" {
		return httpdl.HTTP{Dir: a.Dir}.Download(ctx, task, progress)
	}
	taskDir := filepath.Join(a.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return downloader.Result{}, err
	}

	aria, err := a.client(ctx)
	if err != nil {
		return downloader.Result{}, err
	}
	defer aria.Close()

	if shouldAttachExistingAria2Task(task) {
		status, ok, err := a.findTask(ctx, &aria, task)
		if err != nil {
			return downloader.Result{}, fmt.Errorf("find aria2 task: %w", err)
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
	if a.RetainSeed && task.SourceType() != "http" {
		// Let aria2 stop seeding on its own after the configured window so a seed
		// can never outlive its retention even if the worker loses track of it.
		options.SeedTime = aria2SeedTimeMinutes(a.SeedDuration)
		options.SeedRatio = float32(a.SeedRatio)
	}
	if task.Name() != "" && task.SourceType() == "http" {
		options.GID = aria2TaskGID(task.ID)
		options.Out = task.Name()
	}
	gid, err := addAria2Task(ctx, aria, task, options)
	if err != nil {
		if !isAria2InfoHashAlreadyRegistered(err) {
			return downloader.Result{}, fmt.Errorf("add aria2 task: %w", err)
		}
		status, ok, findErr := a.findTask(ctx, &aria, task)
		if findErr != nil {
			return downloader.Result{}, fmt.Errorf("find aria2 task after add failed: %w", findErr)
		}
		if !ok {
			return downloader.Result{}, fmt.Errorf("add aria2 uri: %w", err)
		}
		gid.GID = status.GID
		taskDir = aria2StatusTaskDir(status, taskDir)
	}
	result, err := a.waitResult(ctx, &aria, task, taskDir, gid.GID, progress)
	if err != nil {
		if isAria2InfoHashAlreadyRegistered(err) {
			status, ok, findErr := a.findTask(ctx, &aria, task)
			if findErr != nil {
				return downloader.Result{}, fmt.Errorf("find aria2 task after infohash conflict: %w", findErr)
			}
			if ok {
				return a.waitResult(ctx, &aria, task, aria2StatusTaskDir(status, taskDir), status.GID, progress)
			}
		}
		return downloader.Result{}, fmt.Errorf("wait aria2 result: %w", err)
	}
	return result, nil
}

func shouldAttachExistingAria2Task(task downloader.DownloadTask) bool {
	// 'interrupted' is how a task comes back after a downloader restart. aria2
	// reloads the same download from its saved session, so we must attach to it
	// — re-adding would create a duplicate that errors (infohash already
	// registered) and orphans the real download from progress reporting.
	switch task.State() {
	case "downloading", "uploading", "interrupted":
		return true
	default:
		return false
	}
}

func (a Aria2) snapshotTask(
	ctx context.Context,
	aria **arigo.Client,
	task downloader.DownloadTask,
	status arigo.Status,
) (downloader.TaskSnapshot, bool, error) {
	total := int64(status.TotalLength)
	completed := int64(status.CompletedLength)
	bps := int64(status.DownloadSpeed)
	var totalPtr *int64
	if total > 0 {
		totalPtr = &total
	}
	peers := a.getAria2Peers(ctx, aria, status.GID)
	snapshot := downloader.TaskSnapshot{
		State:      aria2TaskState(status),
		Downloaded: completed,
		Total:      totalPtr,
		Bps:        bps,
		Runtime:    aria2Detail(status, peers, a.GeoIP),
		Error:      status.ErrorMessage,
	}
	if snapshot.State != downloader.TaskStateCompleted {
		return snapshot, true, nil
	}
	files, err := a.getAria2Files(ctx, aria, status.GID)
	if err != nil {
		return downloader.TaskSnapshot{}, false, err
	}
	taskDir := aria2StatusTaskDir(status, filepath.Join(a.Dir, task.ID))
	result, err := resultFromAria2Files(task, taskDir, status.BitTorrent.Info.Name, files)
	if err != nil {
		return downloader.TaskSnapshot{}, false, err
	}
	if a.RetainSeed && task.SourceType() != "http" {
		result.Seed = a.seedFromStatus(status, taskDir)
	}
	snapshot.Result = &result
	return snapshot, true, nil
}

func aria2TaskState(status arigo.Status) downloader.TaskState {
	if isAria2DownloadComplete(status) {
		return downloader.TaskStateCompleted
	}
	switch string(status.Status) {
	case string(arigo.StatusError), string(arigo.StatusRemoved):
		return downloader.TaskStateFailed
	default:
		return downloader.TaskStateDownloading
	}
}

func addAria2Task(ctx context.Context, aria *arigo.Client, task downloader.DownloadTask, options *arigo.Options) (arigo.GID, error) {
	if task.SourceType() != "torrent_url" {
		return aria.AddURI(arigo.URIs(task.SourceURI()), options)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, task.SourceURI(), nil)
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

func (a Aria2) waitResult(ctx context.Context, aria **arigo.Client, task downloader.DownloadTask, taskDir string, gid string, progress downloader.ProgressReporter) (downloader.Result, error) {
	initialProgress := progress
	if task.SourceType() != "http" {
		initialProgress = reportMetadataProgress(progress)
	}
	primaryGID := gid
	status, err := a.waitAria2(ctx, aria, task, primaryGID, initialProgress)
	if err != nil {
		_ = (*aria).Remove(primaryGID)
		return downloader.Result{}, fmt.Errorf("wait primary gid %s: %w", primaryGID, err)
	}
	resultGID := status.GID
	if len(status.FollowedBy) > 0 {
		childGID := status.FollowedBy[0]
		status, err = a.waitAria2(ctx, aria, task, childGID, progress)
		if err != nil {
			_ = (*aria).Remove(childGID)
			return downloader.Result{}, fmt.Errorf("wait followed gid %s: %w", childGID, err)
		}
		resultGID = status.GID
	}
	files, err := a.getAria2Files(ctx, aria, status.GID)
	if err != nil {
		return downloader.Result{}, fmt.Errorf("get files for gid %s: %w", status.GID, err)
	}
	result, err := resultFromAria2Files(task, taskDir, status.BitTorrent.Info.Name, files)
	if err != nil {
		return downloader.Result{}, fmt.Errorf("build result from aria2 files: %w", err)
	}
	if a.RetainSeed && task.SourceType() != "http" {
		result.Seed = a.seedFromStatus(status, taskDir)
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

func (a Aria2) seedFromStatus(status arigo.Status, taskDir string) *downloader.Seed {
	return &downloader.Seed{
		Engine:   "aria2",
		ID:       status.GID,
		InfoHash: strings.ToLower(status.InfoHash),
		Path:     taskDir,
		Snapshot: a.seedSnapshot(status.GID),
		Cleanup:  a.cleanupSeed(status.GID, taskDir),
	}
}

func isAria2DownloadComplete(status arigo.Status) bool {
	total := int64(status.TotalLength)
	completed := int64(status.CompletedLength)
	if total > 0 && completed >= total && hasAria2LocalFile(status.Files) {
		return true
	}
	return string(status.Status) == string(arigo.StatusCompleted)
}

func (a Aria2) findSeed(ctx context.Context, aria **arigo.Client, ref downloader.SeedRef) (arigo.Status, bool, error) {
	taskDir := aria2SeedTaskDir(a.Dir, ref)
	if ref.ID != "" {
		status, err := tellAria2Status(*aria, ref.ID)
		if err == nil {
			if isAria2SeedStatus(status) {
				return status, true, nil
			}
		}
		if isAria2RPCDisconnected(err) {
			if err := a.reconnect(ctx, aria); err != nil {
				return arigo.Status{}, false, err
			}
			status, err = tellAria2Status(*aria, ref.ID)
			if err == nil {
				if isAria2SeedStatus(status) {
					return status, true, nil
				}
			}
		}
	}
	statuses, err := a.taskStatuses(ctx, aria)
	if err != nil {
		return arigo.Status{}, false, err
	}
	status, ok := selectAria2SeedStatus(statuses, ref, taskDir)
	if ok {
		return status, true, nil
	}
	return arigo.Status{}, false, nil
}

func selectAria2SeedStatus(statuses []arigo.Status, ref downloader.SeedRef, taskDir string) (arigo.Status, bool) {
	infoHash := strings.ToLower(ref.InfoHash)
	for _, status := range statuses {
		if !isAria2SeedStatus(status) {
			continue
		}
		if infoHash != "" && strings.EqualFold(status.InfoHash, infoHash) {
			return status, true
		}
		if taskDir != "" && filepath.Clean(status.Dir) == taskDir {
			return status, true
		}
	}
	return arigo.Status{}, false
}

func aria2SeedTaskDir(root string, ref downloader.SeedRef) string {
	taskDir := filepath.Clean(ref.Path)
	if taskDir == "." || taskDir == string(filepath.Separator) {
		taskDir = filepath.Clean(filepath.Join(root, ref.TaskID))
	}
	return taskDir
}

func isAria2SeedStatus(status arigo.Status) bool {
	total := int64(status.TotalLength)
	return total > 0 && int64(status.CompletedLength) >= total && hasAria2LocalFile(status.Files)
}

func (a Aria2) client(ctx context.Context) (*arigo.Client, error) {
	return arigo.DialContext(ctx, a.URL, a.Secret)
}

func (a Aria2) findTask(ctx context.Context, aria **arigo.Client, task downloader.DownloadTask) (arigo.Status, bool, error) {
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
		// Skip dead duplicates (e.g. an error-12 "infohash already registered"
		// entry left by a prior re-add) so we attach to the live download, not it.
		switch string(status.Status) {
		case string(arigo.StatusError), string(arigo.StatusRemoved):
			continue
		}
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

func aria2TaskInfoHash(task downloader.DownloadTask) string {
	runtime := task.Runtime()
	if runtime != nil && runtime.Torrent != nil && runtime.Torrent.InfoHash != "" {
		return strings.ToLower(runtime.Torrent.InfoHash)
	}
	if task.SourceType() != "magnet" {
		return ""
	}
	u, err := url.Parse(task.SourceURI())
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
		abs, _ := core.DownloadedPath(taskDir, file.Path)
		if strings.HasPrefix(filepath.Clean(abs), taskDir+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func aria2StatusBelongsToTask(status arigo.Status, taskDir string, gid string) bool {
	if status.GID == gid || status.Following == gid || status.BelongsTo == gid {
		return true
	}
	if filepath.Clean(status.Dir) == taskDir {
		return true
	}
	for _, file := range status.Files {
		if file.Path == "" {
			continue
		}
		abs, _ := core.DownloadedPath(taskDir, file.Path)
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

func (a Aria2) seedSnapshot(gid string) func(context.Context) (downloader.SeedSnapshot, error) {
	return func(ctx context.Context) (downloader.SeedSnapshot, error) {
		aria, err := a.client(ctx)
		if err != nil {
			return downloader.SeedSnapshot{}, err
		}
		defer aria.Close()
		status, err := tellAria2Status(aria, gid)
		if err != nil {
			return downloader.SeedSnapshot{}, err
		}
		peers := a.getAria2Peers(ctx, &aria, gid)
		total := int64(status.TotalLength)
		var totalPtr *int64
		if total > 0 {
			totalPtr = &total
		}
		detail := aria2Detail(status, peers, a.GeoIP)
		detail.Phase = "seeding"
		return downloader.SeedSnapshot{
			Downloaded: int64(status.CompletedLength),
			Total:      totalPtr,
			Bps:        int64(status.DownloadSpeed),
			Runtime:    detail,
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

func (a Aria2) waitAria2(ctx context.Context, aria **arigo.Client, task downloader.DownloadTask, gid string, progress downloader.ProgressReporter) (arigo.Status, error) {
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
				if isAria2GIDNotFound(err) {
					recovered, ok, findErr := a.findTask(ctx, aria, task)
					if findErr != nil {
						return arigo.Status{}, findErr
					}
					if !ok || recovered.GID == gid {
						return arigo.Status{}, err
					}
					gid = recovered.GID
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
			if err := progress(downloader.ProgressUpdate{
				Downloaded: completed,
				Total:      totalPtr,
				Bps:        bps,
				Runtime:    aria2Detail(status, peers, a.GeoIP),
			}); err != nil {
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

func reportMetadataProgress(progress downloader.ProgressReporter) downloader.ProgressReporter {
	return func(update downloader.ProgressUpdate) error {
		update.Downloaded = 0
		update.Total = nil
		update.Bps = 0
		if update.Runtime != nil {
			update.Runtime.Phase = "metadata"
			update.Runtime.ETASeconds = nil
		}
		return progress(update)
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
	if err == nil {
		return false
	}
	return errors.Is(err, rpc2.ErrShutdown) || errors.Is(err, io.ErrClosedPipe) || strings.Contains(err.Error(), "connection is shut down")
}

func aria2Detail(status arigo.Status, peers []arigo.Peer, geoIP geoip.Resolver) *downloader.TaskRuntime {
	connections := int64(status.Connections)
	seeders := int64(status.NumSeeders)
	peerCount := int64(len(peers))
	leechers := aria2Leechers(peers)
	uploaded := int64(status.UploadLength)
	uploadBps := int64(status.UploadSpeed)
	detail := &downloader.TaskRuntime{
		Engine:      "aria2",
		Phase:       aria2Phase(status),
		State:       string(status.Status),
		ETASeconds:  aria2ETA(status),
		Connections: &connections,
		Torrent: &downloader.TorrentRuntime{
			InfoHash: status.InfoHash,
			Name:     status.BitTorrent.Info.Name,
			Seeders:  &seeders,
			Leechers: leechers,
			Peers:    &peerCount,
		},
		Seeding: &downloader.SeedingRuntime{
			UploadedBytes:        &uploaded,
			UploadBytesPerSecond: &uploadBps,
		},
		Trackers: aria2Trackers(status.BitTorrent.AnnounceList),
		Peers:    aria2Peers(peers, geoIP),
		Files:    aria2Files(status.Dir, status.BitTorrent.Info.Name, status.Files),
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

func aria2Phase(status arigo.Status) string {
	switch string(status.Status) {
	case string(arigo.StatusWaiting):
		if len(status.FollowedBy) > 0 {
			return "metadata"
		}
		return "downloading"
	case string(arigo.StatusActive):
		if !hasAria2LocalFile(status.Files) && system.IsAria2MetadataPath(firstAria2FilePath(status.Files)) {
			return "metadata"
		}
		return "downloading"
	case "complete", string(arigo.StatusCompleted):
		return "completed"
	case string(arigo.StatusError), string(arigo.StatusRemoved):
		return "error"
	default:
		return "downloading"
	}
}

func firstAria2FilePath(files []arigo.File) string {
	if len(files) == 0 {
		return ""
	}
	return files[0].Path
}

func aria2Trackers(announceList [][]string) []downloader.Tracker {
	trackers := make([]downloader.Tracker, 0, 20)
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
			trackers = append(trackers, downloader.Tracker{
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

// aria2PeerProgress derives a peer's 0..1 completion from its piece bitfield
// (aria2 has no direct percentage like qBittorrent). A seeder has every piece.
// Spare bits past the last piece are zero, so dividing by the bitfield's bit
// length only differs from the true piece count by sub-1% — fine for a bar.
func aria2PeerProgress(peer arigo.Peer) *float64 {
	if peer.Seeder {
		full := 1.0
		return &full
	}
	if peer.BitField == "" {
		return nil
	}
	set := 0
	for _, digit := range peer.BitField {
		nibble, err := strconv.ParseUint(string(digit), 16, 8)
		if err != nil {
			return nil
		}
		set += bits.OnesCount8(uint8(nibble))
	}
	total := len(peer.BitField) * 4
	if total == 0 {
		return nil
	}
	progress := float64(set) / float64(total)
	return &progress
}

func aria2Peers(peers []arigo.Peer, geoIP geoip.Resolver) []downloader.Peer {
	out := make([]downloader.Peer, 0, min(len(peers), 20))
	for _, peer := range peers {
		if peer.IP == "" {
			continue
		}
		down := int64(peer.DownloadSpeed)
		up := int64(peer.UploadSpeed)
		item := downloader.Peer{
			Address:     fmt.Sprintf("%s:%d", peer.IP, peer.Port),
			Progress:    aria2PeerProgress(peer),
			DownloadBps: &down,
			UploadBps:   &up,
		}
		core.ApplyPeerRegion(&item, peer.IP, "", geoIP)
		out = append(out, item)
		if len(out) >= 20 {
			break
		}
	}
	return out
}

func aria2Files(baseDir string, torrentName string, files []arigo.File) []downloader.File {
	out := make([]downloader.File, 0, min(len(files), 50))
	for _, file := range files {
		if file.Path == "" || system.IsAria2MetadataPath(file.Path) {
			continue
		}
		_, rel := core.DownloadedPath(baseDir, file.Path)
		rel = core.StripTorrentRoot(rel, torrentName)
		size := int64(file.Length)
		completed := int64(file.CompletedLength)
		selected := file.Selected
		out = append(out, downloader.File{
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
		if file.Path != "" && !system.IsAria2MetadataPath(file.Path) {
			return true
		}
	}
	return false
}

func resultFromAria2Files(task downloader.DownloadTask, taskDir string, fallbackName string, files []arigo.File) (downloader.Result, error) {
	downloaded := make([]core.DownloadedFile, 0, len(files))
	for _, file := range files {
		if file.Selected && file.Length > 0 && !system.IsDownloadSidecarPath(file.Path) {
			abs, rel := core.DownloadedPath(taskDir, file.Path)
			downloaded = append(downloaded, core.DownloadedFile{Path: abs, RelativePath: rel})
		}
	}
	if len(downloaded) == 0 {
		return core.ResultFromPath(task, taskDir, fallbackName)
	}
	return core.ResultFromDownloadedFiles(task, taskDir, fallbackName, downloaded)
}
