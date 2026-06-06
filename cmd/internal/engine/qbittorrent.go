package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	qbittorrent "github.com/autobrr/go-qbittorrent"
	"github.com/saltbo/zpan/cmd/internal/client"
)

type QBittorrent struct {
	URL        string
	Username   string
	Password   string
	Dir        string
	RetainSeed bool
	GeoIP      PeerGeoIPResolver
}

func (q QBittorrent) Name() string {
	return "qbittorrent"
}

func (q QBittorrent) Capabilities() []string {
	return []string{"http", "magnet", "torrent"}
}

func (q QBittorrent) Start(ctx context.Context) (*exec.Cmd, error) {
	path, err := lookPathAny("qbittorrent-nox", "qbittorrent")
	if err != nil {
		return nil, err
	}
	webURL, err := parseLocalEngineURL(q.URL, "8080")
	if err != nil {
		return nil, err
	}
	args := []string{}
	if strings.Contains(filepathBase(path), "qbittorrent-nox") {
		args = append(args, "--webui-port="+webURL.port)
	}
	cmd := exec.Command(path, args...)
	configureEngineProcess(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	go func() { _ = cmd.Wait() }()
	return cmd, nil
}

func (q QBittorrent) Check(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(q.URL, "/")+"/api/v2/app/version", nil)
	if err != nil {
		return err
	}
	res, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("qbittorrent web api returned %s", res.Status)
	}
	version, err := io.ReadAll(io.LimitReader(res.Body, 256))
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(version)) == "" {
		return errors.New("qbittorrent web api did not return a version")
	}
	return nil
}

func (q QBittorrent) ResetTask(ctx context.Context, task client.DownloadTask) error {
	if task.SourceType() == "http" {
		return HTTP{Dir: q.Dir}.ResetTask(ctx, task)
	}
	qbt, err := q.login(ctx)
	if err != nil {
		return err
	}
	taskDir := filepath.Clean(filepath.Join(q.Dir, task.ID))
	tag := qbittorrentTrackingTag(task.ID)
	tagged, err := qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{Tag: tag})
	if err != nil {
		return err
	}
	all, err := qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{})
	if err != nil {
		return err
	}
	seen := map[string]struct{}{}
	hashes := make([]string, 0, len(tagged))
	for _, torrent := range append(tagged, all...) {
		if torrent.Hash == "" {
			continue
		}
		if _, ok := seen[torrent.Hash]; ok {
			continue
		}
		if filepath.Clean(torrent.SavePath) != taskDir && !torrentHasTag(torrent.Tags, tag) {
			continue
		}
		seen[torrent.Hash] = struct{}{}
		hashes = append(hashes, torrent.Hash)
	}
	if len(hashes) > 0 {
		if err := qbt.DeleteTorrentsCtx(ctx, hashes, false); err != nil {
			return err
		}
	}
	return os.RemoveAll(taskDir)
}

func (q QBittorrent) RestoreSeed(ctx context.Context, ref SeedRef) (*Seed, error) {
	qbt, err := q.login(ctx)
	if err != nil {
		return nil, err
	}
	hash := ref.InfoHash
	if hash == "" {
		hash = ref.ID
	}
	if hash == "" {
		return nil, nil
	}
	torrents, err := qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{Hashes: []string{hash}})
	if err != nil {
		return nil, err
	}
	if len(torrents) == 0 {
		return nil, nil
	}
	torrent := torrents[0]
	if torrent.Progress < 1 && !(torrent.AmountLeft == 0 && torrent.TotalSize > 0) {
		return nil, nil
	}
	path := ref.Path
	if path == "" {
		path = filepath.Join(q.Dir, ref.TaskID)
	}
	_ = qbt.StartCtx(ctx, []string{torrent.Hash})
	return &Seed{
		Engine:   "qbittorrent",
		ID:       torrent.Hash,
		InfoHash: torrent.Hash,
		Path:     path,
		Snapshot: q.seedSnapshot(torrent.Hash),
		Cleanup:  q.cleanupSeed(torrent.Hash, path),
	}, nil
}

func (q QBittorrent) InspectTask(ctx context.Context, task client.DownloadTask) (TaskSnapshot, bool, error) {
	if task.SourceType() == "http" {
		return HTTP{Dir: q.Dir}.InspectTask(ctx, task)
	}
	qbt, err := q.login(ctx)
	if err != nil {
		return TaskSnapshot{}, false, err
	}
	torrent, ok, err := q.findTask(ctx, qbt, task)
	if err != nil || !ok {
		return TaskSnapshot{}, ok, err
	}
	return q.snapshotTask(ctx, qbt, task, torrent)
}

func (q QBittorrent) login(ctx context.Context) (*qbittorrent.Client, error) {
	qbt := qbittorrent.NewClient(qbittorrent.Config{
		Host:     q.URL,
		Username: q.Username,
		Password: q.Password,
		Timeout:  10,
	})
	if err := qbt.LoginCtx(ctx); err != nil {
		return nil, err
	}
	return qbt, nil
}

func (q QBittorrent) Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error) {
	if task.SourceType() == "http" {
		return HTTP{Dir: q.Dir}.Download(ctx, task, progress)
	}
	taskDir := filepath.Join(q.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return Result{}, err
	}

	qbt, err := q.login(ctx)
	if err != nil {
		return Result{}, err
	}

	tag := qbittorrentTrackingTag(task.ID)
	torrent, ok, err := q.findTask(ctx, qbt, task)
	if err != nil {
		return Result{}, err
	}
	if ok {
		_ = qbt.StartCtx(ctx, []string{torrent.Hash})
		torrent, err = waitQBittorrent(ctx, qbt, tag, progress, q.GeoIP)
		if err != nil {
			return Result{}, err
		}
		return q.resultFromTorrent(ctx, qbt, task, taskDir, torrent)
	}

	options := qbittorrentAddOptions(task, taskDir, tag)
	if _, err := qbt.AddTorrentFromUrlCtx(ctx, task.SourceURI(), options); err != nil {
		return Result{}, err
	}

	torrent, err = waitQBittorrent(ctx, qbt, tag, progress, q.GeoIP)
	if err != nil {
		return Result{}, err
	}
	return q.resultFromTorrent(ctx, qbt, task, taskDir, torrent)
}

func (q QBittorrent) resultFromTorrent(
	ctx context.Context,
	qbt *qbittorrent.Client,
	task client.DownloadTask,
	taskDir string,
	torrent qbittorrent.Torrent,
) (Result, error) {
	result, err := resultFromQBittorrentFiles(ctx, qbt, task, taskDir, torrent)
	if err != nil {
		return Result{}, err
	}
	if q.RetainSeed {
		result.Seed = &Seed{
			Engine:   "qbittorrent",
			ID:       torrent.Hash,
			InfoHash: torrent.Hash,
			Path:     taskDir,
			Snapshot: q.seedSnapshot(torrent.Hash),
			Cleanup:  q.cleanupSeed(torrent.Hash, taskDir),
		}
		return result, nil
	}
	_ = qbt.DeleteTorrentsCtx(ctx, []string{torrent.Hash}, false)
	return result, nil
}

func (q QBittorrent) snapshotTask(
	ctx context.Context,
	qbt *qbittorrent.Client,
	task client.DownloadTask,
	torrent qbittorrent.Torrent,
) (TaskSnapshot, bool, error) {
	total := torrent.TotalSize
	if total <= 0 {
		total = torrent.Size
	}
	var totalPtr *int64
	if total > 0 {
		totalPtr = &total
	}
	snapshot := TaskSnapshot{
		State:      qbittorrentTaskState(torrent),
		Downloaded: torrent.Completed,
		Total:      totalPtr,
		Bps:        torrent.DlSpeed,
		Runtime:    qbittorrentDetail(ctx, qbt, torrent, q.GeoIP),
	}
	if snapshot.State != TaskStateCompleted {
		return snapshot, true, nil
	}
	result, err := resultFromQBittorrentFiles(ctx, qbt, task, filepath.Join(q.Dir, task.ID), torrent)
	if err != nil {
		return TaskSnapshot{}, false, err
	}
	if q.RetainSeed {
		result.Seed = &Seed{
			Engine:   "qbittorrent",
			ID:       torrent.Hash,
			InfoHash: torrent.Hash,
			Path:     filepath.Join(q.Dir, task.ID),
			Snapshot: q.seedSnapshot(torrent.Hash),
			Cleanup:  q.cleanupSeed(torrent.Hash, filepath.Join(q.Dir, task.ID)),
		}
	}
	snapshot.Result = &result
	return snapshot, true, nil
}

func qbittorrentTaskState(torrent qbittorrent.Torrent) TaskState {
	total := torrent.TotalSize
	if total <= 0 {
		total = torrent.Size
	}
	if torrent.Progress >= 1 || (torrent.AmountLeft == 0 && total > 0) {
		return TaskStateCompleted
	}
	if isQBittorrentErrorState(torrent.State) {
		return TaskStateFailed
	}
	return TaskStateDownloading
}

func (q QBittorrent) findTask(ctx context.Context, qbt *qbittorrent.Client, task client.DownloadTask) (qbittorrent.Torrent, bool, error) {
	tag := qbittorrentTrackingTag(task.ID)
	torrents, err := qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{Tag: tag})
	if err != nil {
		return qbittorrent.Torrent{}, false, err
	}
	if len(torrents) > 0 {
		return torrents[0], true, nil
	}
	taskDir := filepath.Clean(filepath.Join(q.Dir, task.ID))
	torrents, err = qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{})
	if err != nil {
		return qbittorrent.Torrent{}, false, err
	}
	for _, torrent := range torrents {
		if filepath.Clean(torrent.SavePath) == taskDir {
			return torrent, true, nil
		}
	}
	return qbittorrent.Torrent{}, false, nil
}

func qbittorrentAddOptions(task client.DownloadTask, taskDir string, trackingTag string) map[string]string {
	category := "zpan"
	if task.Category() != "" {
		category = task.Category()
	}
	tags := append([]string{trackingTag}, task.Tags()...)
	options := (&qbittorrent.TorrentAddOptions{
		SavePath:           taskDir,
		Category:           category,
		Tags:               strings.Join(tags, ","),
		LimitRatio:         0,
		LimitSeedTime:      0,
		SequentialDownload: false,
	}).Prepare()
	if name := requestedOutputName(task); name != "" {
		options["rename"] = name
	}
	return options
}

func qbittorrentTrackingTag(taskID string) string {
	return "ztid=" + taskID
}

func torrentHasTag(tags string, want string) bool {
	for _, tag := range strings.Split(tags, ",") {
		if strings.TrimSpace(tag) == want {
			return true
		}
	}
	return false
}

func (q QBittorrent) cleanupSeed(hash string, localPath string) func(context.Context) error {
	return func(ctx context.Context) error {
		var errs []error
		qbt, err := q.login(ctx)
		if err != nil {
			errs = append(errs, err)
		} else if err := qbt.DeleteTorrentsCtx(ctx, []string{hash}, false); err != nil {
			errs = append(errs, err)
		}
		if err := os.RemoveAll(localPath); err != nil {
			errs = append(errs, err)
		}
		return errors.Join(errs...)
	}
}

func (q QBittorrent) seedSnapshot(hash string) func(context.Context) (SeedSnapshot, error) {
	return func(ctx context.Context) (SeedSnapshot, error) {
		qbt, err := q.login(ctx)
		if err != nil {
			return SeedSnapshot{}, err
		}
		torrents, err := qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{Hashes: []string{hash}})
		if err != nil {
			return SeedSnapshot{}, err
		}
		if len(torrents) == 0 {
			return SeedSnapshot{}, fmt.Errorf("qbittorrent torrent %s not found", hash)
		}
		torrent := torrents[0]
		total := torrent.TotalSize
		if total <= 0 {
			total = torrent.Size
		}
		var totalPtr *int64
		if total > 0 {
			totalPtr = &total
		}
		detail := qbittorrentDetail(ctx, qbt, torrent, q.GeoIP)
		detail.Phase = "seeding"
		return SeedSnapshot{
			Downloaded: torrent.Completed,
			Total:      totalPtr,
			Bps:        torrent.DlSpeed,
			Runtime:    detail,
		}, nil
	}
}

func waitQBittorrent(
	ctx context.Context,
	qbt *qbittorrent.Client,
	tag string,
	progress Progress,
	geoIP PeerGeoIPResolver,
) (qbittorrent.Torrent, error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return qbittorrent.Torrent{}, ctx.Err()
		case <-ticker.C:
			torrents, err := qbt.GetTorrentsCtx(ctx, qbittorrent.TorrentFilterOptions{Tag: tag})
			if err != nil {
				return qbittorrent.Torrent{}, err
			}
			if len(torrents) == 0 {
				continue
			}
			torrent := torrents[0]
			total := torrent.TotalSize
			if total <= 0 {
				total = torrent.Size
			}
			var totalPtr *int64
			if total > 0 {
				totalPtr = &total
			}
			if err := progress(torrent.Completed, totalPtr, torrent.DlSpeed, qbittorrentDetail(ctx, qbt, torrent, geoIP)); err != nil {
				_ = qbt.StopCtx(ctx, []string{torrent.Hash})
				return qbittorrent.Torrent{}, err
			}
			if torrent.Progress >= 1 || (torrent.AmountLeft == 0 && total > 0) {
				return torrent, nil
			}
			if isQBittorrentErrorState(torrent.State) {
				return qbittorrent.Torrent{}, fmt.Errorf("qbittorrent download ended with state %s", torrent.State)
			}
		}
	}
}

func qbittorrentDetail(
	ctx context.Context,
	qbt *qbittorrent.Client,
	torrent qbittorrent.Torrent,
	geoIP PeerGeoIPResolver,
) *client.DownloadTaskRuntime {
	connections := int64(torrent.NumSeeds + torrent.NumLeechs)
	seeders := torrent.NumSeeds
	leechers := torrent.NumLeechs
	peers := torrent.NumComplete + torrent.NumIncomplete
	uploaded := torrent.Uploaded
	uploadBps := torrent.UpSpeed
	var eta *int64
	if torrent.ETA >= 0 {
		eta = &torrent.ETA
	}
	detail := &client.DownloadTaskRuntime{
		Engine:      "qbittorrent",
		Phase:       qbittorrentPhase(string(torrent.State)),
		State:       string(torrent.State),
		ETASeconds:  eta,
		Connections: &connections,
		Torrent: &client.DownloadTaskTorrentRuntime{
			InfoHash: torrent.Hash,
			Name:     torrent.Name,
			Seeders:  &seeders,
			Leechers: &leechers,
			Peers:    &peers,
		},
		Seeding: &client.DownloadTaskSeedingRuntime{
			UploadedBytes:        &uploaded,
			UploadBytesPerSecond: &uploadBps,
		},
		Trackers: qbittorrentTrackers(ctx, qbt, torrent),
		Peers:    qbittorrentPeers(ctx, qbt, torrent.Hash, geoIP),
		Files:    qbittorrentFiles(ctx, qbt, torrent),
	}
	if detail.Phase == "seeding" {
		detail.ETASeconds = nil
	}
	return detail
}

func qbittorrentPhase(state string) string {
	normalized := strings.ToLower(state)
	switch {
	case strings.Contains(normalized, "meta"):
		return "metadata"
	case strings.Contains(normalized, "up"), strings.Contains(normalized, "seed"):
		return "seeding"
	case strings.Contains(normalized, "error"), strings.Contains(normalized, "missing"):
		return "error"
	case strings.Contains(normalized, "paused"):
		return "downloading"
	case normalized == "uploading":
		return "seeding"
	default:
		return "downloading"
	}
}

func qbittorrentTrackers(ctx context.Context, qbt *qbittorrent.Client, torrent qbittorrent.Torrent) []client.DownloadTaskTracker {
	trackers := torrent.Trackers
	if len(trackers) == 0 && torrent.Hash != "" {
		loaded, err := qbt.GetTorrentTrackersCtx(ctx, torrent.Hash)
		if err == nil {
			trackers = loaded
		}
	}
	out := make([]client.DownloadTaskTracker, 0, min(len(trackers), 20))
	for _, tracker := range trackers {
		peers := int64(tracker.NumPeers)
		seeds := int64(tracker.NumSeeds)
		leechers := int64(tracker.NumLeechers)
		out = append(out, client.DownloadTaskTracker{
			URL:      tracker.Url,
			Status:   fmt.Sprint(tracker.Status),
			Peers:    &peers,
			Seeds:    &seeds,
			Leechers: &leechers,
			Message:  tracker.Message,
		})
		if len(out) >= 20 {
			break
		}
	}
	return out
}

func qbittorrentPeers(ctx context.Context, qbt *qbittorrent.Client, hash string, geoIP PeerGeoIPResolver) []client.DownloadTaskPeer {
	if hash == "" {
		return nil
	}
	peers, err := qbt.GetTorrentPeersCtx(ctx, hash, 0)
	if err != nil || peers == nil {
		return nil
	}
	out := make([]client.DownloadTaskPeer, 0, min(len(peers.Peers), 20))
	for address, peer := range peers.Peers {
		progress := peer.Progress
		down := peer.DownSpeed
		up := peer.UpSpeed
		label := address
		if peer.IP != "" && peer.Port > 0 {
			label = fmt.Sprintf("%s:%d", peer.IP, peer.Port)
		}
		item := client.DownloadTaskPeer{
			Address:     label,
			Client:      peer.Client,
			Progress:    &progress,
			DownloadBps: &down,
			UploadBps:   &up,
		}
		applyPeerRegion(&item, peer.IP, peer.CountryCode, geoIP)
		out = append(out, item)
		if len(out) >= 20 {
			break
		}
	}
	return out
}

func qbittorrentFiles(ctx context.Context, qbt *qbittorrent.Client, torrent qbittorrent.Torrent) []client.DownloadTaskFile {
	if torrent.Hash == "" {
		return nil
	}
	files, err := qbt.GetFilesInformationCtx(ctx, torrent.Hash)
	if err != nil || files == nil {
		return nil
	}
	out := make([]client.DownloadTaskFile, 0, min(len(*files), 50))
	for _, file := range *files {
		if file.Size <= 0 {
			continue
		}
		completed := int64(float64(file.Size) * float64(file.Progress))
		selected := file.Priority > 0
		out = append(out, client.DownloadTaskFile{
			Path:           stripTorrentRoot(file.Name, torrent.Name),
			Size:           file.Size,
			CompletedBytes: &completed,
			Selected:       &selected,
		})
		if len(out) >= 50 {
			break
		}
	}
	return out
}

func resultFromQBittorrentFiles(
	ctx context.Context,
	qbt *qbittorrent.Client,
	task client.DownloadTask,
	taskDir string,
	torrent qbittorrent.Torrent,
) (Result, error) {
	files, err := qbt.GetFilesInformationCtx(ctx, torrent.Hash)
	if err != nil || files == nil {
		return resultFromPath(task, taskDir, torrent.Name)
	}
	downloaded := make([]downloadedFile, 0, len(*files))
	for _, file := range *files {
		if file.Priority == 0 || file.Size <= 0 {
			continue
		}
		abs, rel := downloadedPath(taskDir, file.Name)
		downloaded = append(downloaded, downloadedFile{path: abs, relativePath: rel})
	}
	if len(downloaded) == 0 {
		return resultFromPath(task, taskDir, torrent.Name)
	}
	return resultFromDownloadedFiles(task, taskDir, torrent.Name, downloaded)
}

func isQBittorrentErrorState(state qbittorrent.TorrentState) bool {
	value := strings.ToLower(string(state))
	return strings.Contains(value, "error") || strings.Contains(value, "missing")
}
