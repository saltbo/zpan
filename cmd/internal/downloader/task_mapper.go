package downloader

import (
	"github.com/saltbo/zpan/internal/client"
)

func downloadTask(task client.DownloadTask) DownloadTask {
	return DownloadTask{
		ID: task.ID,
		Source: Source{
			Type: task.SourceType(),
			URI:  task.SourceURI(),
		},
		Destination: Destination{
			Name: task.Name(),
		},
		Labels: Labels{
			Category: task.Category(),
			Tags:     task.Tags(),
		},
		Status: Status{
			State: task.State(),
			Progress: TaskProgress{
				Download: TransferProgress{
					Bytes:      task.Status.Progress.Download.Bytes,
					TotalBytes: task.Status.Progress.Download.TotalBytes,
					Bps:        task.Status.Progress.Download.BytesPerSecond,
				},
			},
			Runtime: downloaderRuntime(task.Runtime()),
		},
	}
}

func zpanRuntime(runtime *TaskRuntime) *client.DownloadTaskRuntime {
	if runtime == nil {
		return nil
	}
	return &client.DownloadTaskRuntime{
		Engine:      runtime.Engine,
		Phase:       runtime.Phase,
		State:       runtime.State,
		Message:     runtime.Message,
		UpdatedAt:   runtime.UpdatedAt,
		Progress:    zpanRuntimeProgress(runtime.Progress),
		ETASeconds:  runtime.ETASeconds,
		Connections: runtime.Connections,
		Torrent:     zpanTorrentRuntime(runtime.Torrent),
		Seeding:     zpanSeedingRuntime(runtime.Seeding),
		Trackers:    zpanTrackers(runtime.Trackers),
		Peers:       zpanPeers(runtime.Peers),
		Files:       zpanFiles(runtime.Files),
	}
}

func downloaderRuntime(runtime *client.DownloadTaskRuntime) *TaskRuntime {
	if runtime == nil {
		return nil
	}
	return &TaskRuntime{
		Engine:      runtime.Engine,
		Phase:       runtime.Phase,
		State:       runtime.State,
		Message:     runtime.Message,
		UpdatedAt:   runtime.UpdatedAt,
		Progress:    downloaderRuntimeProgress(runtime.Progress),
		ETASeconds:  runtime.ETASeconds,
		Connections: runtime.Connections,
		Torrent:     downloaderTorrentRuntime(runtime.Torrent),
		Seeding:     downloaderSeedingRuntime(runtime.Seeding),
		Trackers:    downloaderTrackers(runtime.Trackers),
		Peers:       downloaderPeers(runtime.Peers),
		Files:       downloaderFiles(runtime.Files),
	}
}

func zpanRuntimeProgress(progress *RuntimeProgress) *client.DownloadTaskProgress {
	if progress == nil {
		return nil
	}
	return &client.DownloadTaskProgress{
		Download: zpanTransferProgress(progress.Download),
		Upload:   zpanTransferProgress(progress.Upload),
	}
}

func downloaderRuntimeProgress(progress *client.DownloadTaskProgress) *RuntimeProgress {
	if progress == nil {
		return nil
	}
	return &RuntimeProgress{
		Download: downloaderTransferProgress(progress.Download),
		Upload:   downloaderTransferProgress(progress.Upload),
	}
}

func zpanTransferProgress(progress TransferProgress) client.DownloadTaskTransferProgress {
	return client.DownloadTaskTransferProgress{
		Bytes:          progress.Bytes,
		TotalBytes:     progress.TotalBytes,
		BytesPerSecond: progress.Bps,
	}
}

func downloaderTransferProgress(progress client.DownloadTaskTransferProgress) TransferProgress {
	return TransferProgress{
		Bytes:      progress.Bytes,
		TotalBytes: progress.TotalBytes,
		Bps:        progress.BytesPerSecond,
	}
}

func zpanTorrentRuntime(torrent *TorrentRuntime) *client.DownloadTaskTorrentRuntime {
	if torrent == nil {
		return nil
	}
	return &client.DownloadTaskTorrentRuntime{
		InfoHash: torrent.InfoHash,
		Name:     torrent.Name,
		Seeders:  torrent.Seeders,
		Leechers: torrent.Leechers,
		Peers:    torrent.Peers,
	}
}

func downloaderTorrentRuntime(torrent *client.DownloadTaskTorrentRuntime) *TorrentRuntime {
	if torrent == nil {
		return nil
	}
	return &TorrentRuntime{
		InfoHash: torrent.InfoHash,
		Name:     torrent.Name,
		Seeders:  torrent.Seeders,
		Leechers: torrent.Leechers,
		Peers:    torrent.Peers,
	}
}

func zpanSeedingRuntime(seeding *SeedingRuntime) *client.DownloadTaskSeedingRuntime {
	if seeding == nil {
		return nil
	}
	return &client.DownloadTaskSeedingRuntime{
		Enabled:              seeding.Enabled,
		Active:               seeding.Active,
		UploadedBytes:        seeding.UploadedBytes,
		UploadBytesPerSecond: seeding.UploadBytesPerSecond,
		Ratio:                seeding.Ratio,
		StartedAt:            seeding.StartedAt,
		ExpiresAt:            seeding.ExpiresAt,
	}
}

func downloaderSeedingRuntime(seeding *client.DownloadTaskSeedingRuntime) *SeedingRuntime {
	if seeding == nil {
		return nil
	}
	return &SeedingRuntime{
		Enabled:              seeding.Enabled,
		Active:               seeding.Active,
		UploadedBytes:        seeding.UploadedBytes,
		UploadBytesPerSecond: seeding.UploadBytesPerSecond,
		Ratio:                seeding.Ratio,
		StartedAt:            seeding.StartedAt,
		ExpiresAt:            seeding.ExpiresAt,
	}
}

func zpanTrackers(trackers []Tracker) []client.DownloadTaskTracker {
	if len(trackers) == 0 {
		return nil
	}
	out := make([]client.DownloadTaskTracker, 0, len(trackers))
	for _, tracker := range trackers {
		out = append(out, client.DownloadTaskTracker{
			URL:      tracker.URL,
			Status:   tracker.Status,
			Peers:    tracker.Peers,
			Seeds:    tracker.Seeds,
			Leechers: tracker.Leechers,
			Message:  tracker.Message,
		})
	}
	return out
}

func downloaderTrackers(trackers []client.DownloadTaskTracker) []Tracker {
	if len(trackers) == 0 {
		return nil
	}
	out := make([]Tracker, 0, len(trackers))
	for _, tracker := range trackers {
		out = append(out, Tracker{
			URL:      tracker.URL,
			Status:   tracker.Status,
			Peers:    tracker.Peers,
			Seeds:    tracker.Seeds,
			Leechers: tracker.Leechers,
			Message:  tracker.Message,
		})
	}
	return out
}

func zpanPeers(peers []Peer) []client.DownloadTaskPeer {
	if len(peers) == 0 {
		return nil
	}
	out := make([]client.DownloadTaskPeer, 0, len(peers))
	for _, peer := range peers {
		out = append(out, client.DownloadTaskPeer{
			Address:     peer.Address,
			Client:      peer.Client,
			CountryCode: peer.CountryCode,
			RegionCode:  peer.RegionCode,
			Progress:    peer.Progress,
			DownloadBps: peer.DownloadBps,
			UploadBps:   peer.UploadBps,
		})
	}
	return out
}

func downloaderPeers(peers []client.DownloadTaskPeer) []Peer {
	if len(peers) == 0 {
		return nil
	}
	out := make([]Peer, 0, len(peers))
	for _, peer := range peers {
		out = append(out, Peer{
			Address:     peer.Address,
			Client:      peer.Client,
			CountryCode: peer.CountryCode,
			RegionCode:  peer.RegionCode,
			Progress:    peer.Progress,
			DownloadBps: peer.DownloadBps,
			UploadBps:   peer.UploadBps,
		})
	}
	return out
}

func zpanFiles(files []File) []client.DownloadTaskFile {
	if len(files) == 0 {
		return nil
	}
	out := make([]client.DownloadTaskFile, 0, len(files))
	for _, file := range files {
		out = append(out, client.DownloadTaskFile{
			Path:           file.Path,
			Size:           file.Size,
			CompletedBytes: file.CompletedBytes,
			Selected:       file.Selected,
		})
	}
	return out
}

func downloaderFiles(files []client.DownloadTaskFile) []File {
	if len(files) == 0 {
		return nil
	}
	out := make([]File, 0, len(files))
	for _, file := range files {
		out = append(out, File{
			Path:           file.Path,
			Size:           file.Size,
			CompletedBytes: file.CompletedBytes,
			Selected:       file.Selected,
		})
	}
	return out
}
