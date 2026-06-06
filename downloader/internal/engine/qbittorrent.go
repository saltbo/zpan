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
	"github.com/saltbo/zpan/downloader/internal/client"
)

type QBittorrent struct {
	URL        string
	Username   string
	Password   string
	Dir        string
	RetainSeed bool
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

func (q QBittorrent) Recover(ctx context.Context, task client.DownloadTask) (Result, bool, error) {
	if task.SourceType == "http" {
		return HTTP{Dir: q.Dir}.Recover(ctx, task)
	}
	qbt, err := q.login(ctx)
	if err != nil {
		return Result{}, false, err
	}
	torrent, ok, err := q.findTask(ctx, qbt, task)
	if err != nil {
		return Result{}, false, err
	}
	if ok && (torrent.Progress >= 1 || (torrent.AmountLeft == 0 && torrent.TotalSize > 0)) {
		result, err := resultFromQBittorrentFiles(ctx, qbt, task, filepath.Join(q.Dir, task.ID), torrent)
		return result, err == nil, err
	}
	if ok {
		return Result{}, false, fmt.Errorf(
			"qbittorrent task %s is not a completed upload resume candidate: state=%s progress=%f amount_left=%d total=%d",
			torrent.Hash,
			torrent.State,
			torrent.Progress,
			torrent.AmountLeft,
			torrent.TotalSize,
		)
	}
	return Result{}, false, nil
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
	if task.SourceType == "http" {
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
		torrent, err = waitQBittorrent(ctx, qbt, tag, progress)
		if err != nil {
			return Result{}, err
		}
		return q.resultFromTorrent(ctx, qbt, task, taskDir, torrent)
	}

	options := qbittorrentAddOptions(task, taskDir, tag)
	if _, err := qbt.AddTorrentFromUrlCtx(ctx, task.SourceURI, options); err != nil {
		return Result{}, err
	}

	torrent, err = waitQBittorrent(ctx, qbt, tag, progress)
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
	if task.Category != "" {
		category = task.Category
	}
	tags := append([]string{trackingTag}, task.Tags...)
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
		detail := qbittorrentDetail(ctx, qbt, torrent)
		detail.Phase = "seeding"
		return SeedSnapshot{
			Downloaded: torrent.Completed,
			Total:      totalPtr,
			Bps:        torrent.DlSpeed,
			Detail:     detail,
		}, nil
	}
}

func waitQBittorrent(
	ctx context.Context,
	qbt *qbittorrent.Client,
	tag string,
	progress Progress,
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
			if err := progress(torrent.Completed, totalPtr, torrent.DlSpeed, qbittorrentDetail(ctx, qbt, torrent)); err != nil {
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

func qbittorrentDetail(ctx context.Context, qbt *qbittorrent.Client, torrent qbittorrent.Torrent) *client.DownloadTaskDetail {
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
	return &client.DownloadTaskDetail{
		Engine:            "qbittorrent",
		Phase:             qbittorrentPhase(string(torrent.State)),
		EngineState:       string(torrent.State),
		ETASeconds:        eta,
		Connections:       &connections,
		InfoHash:          torrent.Hash,
		TorrentName:       torrent.Name,
		Seeders:           &seeders,
		Leechers:          &leechers,
		Peers:             &peers,
		PeerUploadedBytes: &uploaded,
		PeerUploadBps:     &uploadBps,
		Trackers:          qbittorrentTrackers(ctx, qbt, torrent),
		PeerSamples:       qbittorrentPeers(ctx, qbt, torrent.Hash),
	}
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

func qbittorrentPeers(ctx context.Context, qbt *qbittorrent.Client, hash string) []client.DownloadTaskPeer {
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
		out = append(out, client.DownloadTaskPeer{
			Address:     label,
			Client:      peer.Client,
			Progress:    &progress,
			DownloadBps: &down,
			UploadBps:   &up,
		})
		if len(out) >= 20 {
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
