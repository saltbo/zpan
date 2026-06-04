package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Braurbeki/arigo"
	qbittorrent "github.com/autobrr/go-qbittorrent"
	"github.com/cenkalti/rpc2"
	"github.com/saltbo/zpan/downloader/internal/client"
)

type Result struct {
	Path  string
	Name  string
	Size  int64
	IsDir bool
	Seed  *Seed
}

type Seed struct {
	Engine   string
	ID       string
	Path     string
	Snapshot func(context.Context) (SeedSnapshot, error)
	Cleanup  func(context.Context) error
}

type SeedSnapshot struct {
	Downloaded int64
	Total      *int64
	Bps        int64
	Detail     *client.DownloadTaskDetail
}

type Progress func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error

type Engine interface {
	Check(ctx context.Context) error
	Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error)
}

type HTTP struct {
	Dir string
}

func (h HTTP) Check(ctx context.Context) error {
	if err := os.MkdirAll(h.Dir, 0o755); err != nil {
		return err
	}
	file, err := os.CreateTemp(h.Dir, ".zpan-check-*")
	if err != nil {
		return err
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		return err
	}
	return os.Remove(path)
}

func (h HTTP) Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error) {
	if task.SourceType != "http" {
		return Result{}, errors.New("http engine only supports http sources")
	}
	taskDir := filepath.Join(h.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return Result{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, task.SourceURI, nil)
	if err != nil {
		return Result{}, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return Result{}, errors.New(res.Status)
	}

	name := outputName(task, filenameFromURL(req.URL))
	path := filepath.Join(taskDir, name)
	file, err := os.Create(path)
	if err != nil {
		return Result{}, err
	}
	defer file.Close()

	var total *int64
	if res.ContentLength > 0 {
		total = &res.ContentLength
	}
	counter := &progressWriter{progress: progress, total: total, lastAt: time.Now()}
	if _, err := io.Copy(file, io.TeeReader(res.Body, counter)); err != nil {
		return Result{}, err
	}
	if err := progress(counter.downloaded, total, 0, &client.DownloadTaskDetail{Engine: "builtin", Phase: "completed"}); err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: name, Size: counter.downloaded}, nil
}

type Aria2 struct {
	URL        string
	Secret     string
	Dir        string
	RetainSeed bool
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

	options := &arigo.Options{
		Dir:              taskDir,
		FollowTorrent:    true,
		BTSaveMetadata:   true,
		SeedRatio:        0,
		SeedTime:         0,
		AllowOverwrite:   true,
		AutoFileRenaming: false,
	}
	if a.RetainSeed && task.SourceType != "http" {
		options.SeedTime = 1000000
	}
	if task.Name != "" && task.SourceType == "http" {
		options.Out = task.Name
	}
	gid, err := aria.AddURI(arigo.URIs(task.SourceURI), options)
	if err != nil {
		return Result{}, err
	}
	initialProgress := progress
	if task.SourceType != "http" {
		initialProgress = func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskDetail) error { return nil }
	}
	status, err := a.waitAria2(ctx, &aria, gid.GID, initialProgress)
	if err != nil {
		_ = aria.Remove(gid.GID)
		return Result{}, err
	}
	if len(status.FollowedBy) > 0 {
		childGID := status.FollowedBy[0]
		status, err = a.waitAria2(ctx, &aria, childGID, progress)
		if err != nil {
			_ = aria.Remove(childGID)
			return Result{}, err
		}
	}
	files, err := a.getAria2Files(ctx, &aria, status.GID)
	if err != nil {
		return Result{}, err
	}
	result, err := resultFromAria2Files(task, taskDir, files)
	if err != nil {
		return Result{}, err
	}
	if a.RetainSeed && task.SourceType != "http" {
		result.Seed = &Seed{
			Engine:   "aria2",
			ID:       status.GID,
			Path:     taskDir,
			Snapshot: a.seedSnapshot(status.GID),
			Cleanup:  a.cleanupSeed(status.GID, taskDir),
		}
		return result, nil
	}
	_ = aria.ForceRemove(status.GID)
	_ = aria.RemoveDownloadResult(status.GID)
	return result, nil
}

func (a Aria2) client(ctx context.Context) (*arigo.Client, error) {
	return arigo.DialContext(ctx, a.URL, a.Secret)
}

func (a Aria2) seedSnapshot(gid string) func(context.Context) (SeedSnapshot, error) {
	return func(ctx context.Context) (SeedSnapshot, error) {
		aria, err := a.client(ctx)
		if err != nil {
			return SeedSnapshot{}, err
		}
		defer aria.Close()
		status, err := aria.TellStatus(gid)
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

type QBittorrent struct {
	URL        string
	Username   string
	Password   string
	Dir        string
	RetainSeed bool
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
	options := qbittorrentAddOptions(task, taskDir, tag)
	if _, err := qbt.AddTorrentFromUrlCtx(ctx, task.SourceURI, options); err != nil {
		return Result{}, err
	}

	torrent, err := waitQBittorrent(ctx, qbt, tag, progress)
	if err != nil {
		return Result{}, err
	}
	result, err := resultFromPath(task, taskDir, torrent.Name)
	if err != nil {
		return Result{}, err
	}
	if q.RetainSeed {
		result.Seed = &Seed{
			Engine:   "qbittorrent",
			ID:       torrent.Hash,
			Path:     taskDir,
			Snapshot: q.seedSnapshot(torrent.Hash),
			Cleanup:  q.cleanupSeed(torrent.Hash, taskDir),
		}
		return result, nil
	}
	_ = qbt.DeleteTorrentsCtx(ctx, []string{torrent.Hash}, false)
	return result, nil
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
	if task.Name != "" {
		options["rename"] = task.Name
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

type progressWriter struct {
	progress   Progress
	total      *int64
	downloaded int64
	lastBytes  int64
	lastAt     time.Time
}

func (p *progressWriter) Write(data []byte) (int, error) {
	n := len(data)
	p.downloaded += int64(n)
	now := time.Now()
	if now.Sub(p.lastAt) >= time.Second {
		bps := int64(float64(p.downloaded-p.lastBytes) / now.Sub(p.lastAt).Seconds())
		if err := p.progress(p.downloaded, p.total, bps, &client.DownloadTaskDetail{Engine: "builtin", Phase: "downloading"}); err != nil {
			return n, err
		}
		p.lastBytes = p.downloaded
		p.lastAt = now
	}
	return n, nil
}

func (a Aria2) waitAria2(ctx context.Context, aria **arigo.Client, gid string, progress Progress) (arigo.Status, error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return arigo.Status{}, ctx.Err()
		case <-ticker.C:
			status, err := (*aria).TellStatus(gid)
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
		Files:             aria2Files(status.Files),
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

func aria2Files(files []arigo.File) []client.DownloadTaskFile {
	out := make([]client.DownloadTaskFile, 0, min(len(files), 50))
	for _, file := range files {
		if file.Path == "" || isAria2MetadataPath(file.Path) {
			continue
		}
		size := int64(file.Length)
		completed := int64(file.CompletedLength)
		selected := file.Selected
		out = append(out, client.DownloadTaskFile{
			Path:           file.Path,
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

func resultFromAria2Files(task client.DownloadTask, taskDir string, files []arigo.File) (Result, error) {
	paths := make([]string, 0, len(files))
	for _, file := range files {
		if file.Selected && file.Length > 0 && !isAria2MetadataPath(file.Path) {
			paths = append(paths, cleanDownloadedPath(taskDir, file.Path))
		}
	}
	if len(paths) == 1 {
		return resultFromFile(task, paths[0])
	}
	return resultFromPath(task, taskDir, task.Name)
}

func resultFromPath(task client.DownloadTask, path string, fallbackName string) (Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		candidate := filepath.Join(path, fallbackName)
		if fallbackName != "" {
			if _, statErr := os.Stat(candidate); statErr == nil {
				return resultFromPath(task, candidate, fallbackName)
			}
		}
		return Result{}, err
	}
	if !info.IsDir() {
		return resultFromFile(task, path)
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return Result{}, err
	}
	visible := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			visible = append(visible, entry)
		}
	}
	if len(visible) == 1 && !visible[0].IsDir() {
		return resultFromFile(task, filepath.Join(path, visible[0].Name()))
	}
	if len(visible) == 1 && visible[0].IsDir() && strings.TrimSpace(task.Name) == "" {
		return resultFromPath(task, filepath.Join(path, visible[0].Name()), visible[0].Name())
	}
	size, err := directorySize(path)
	if err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: outputName(task, fallbackName), Size: size, IsDir: true}, nil
}

func isAria2MetadataPath(path string) bool {
	return strings.HasPrefix(path, "[MEMORY]") || strings.HasPrefix(path, "[METADATA]")
}

func resultFromFile(task client.DownloadTask, path string) (Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: outputName(task, filepath.Base(path)), Size: info.Size()}, nil
}

func directorySize(path string) (int64, error) {
	var total int64
	err := filepath.WalkDir(path, func(entryPath string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	return total, err
}

func cleanDownloadedPath(baseDir string, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(baseDir, filepath.Clean(path))
}

func outputName(task client.DownloadTask, fallback string) string {
	name := strings.TrimSpace(task.Name)
	if name == "" {
		name = strings.TrimSpace(fallback)
	}
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = task.ID
	}
	return filepath.Base(name)
}

func filenameFromURL(parsed *url.URL) string {
	name := filepath.Base(parsed.Path)
	if name == "." || name == "/" {
		return ""
	}
	return name
}

func isQBittorrentErrorState(state qbittorrent.TorrentState) bool {
	value := strings.ToLower(string(state))
	return strings.Contains(value, "error") || strings.Contains(value, "missing")
}
