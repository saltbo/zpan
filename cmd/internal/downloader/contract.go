package downloader

import (
	"context"
	"time"

	"github.com/saltbo/zpan/pkg/geoip"
)

type Config struct {
	Engine                 string
	DownloadDir            string
	StateDir               string
	BTListenPort           int
	MaxConcurrentDownloads int
	SeedEnabled            bool
	SeedDuration           time.Duration
	SeedRatio              float64
	Aria2                  Aria2Config
	QBittorrent            QBittorrentConfig
	GeoIP                  geoip.Resolver
}

type Aria2Config struct {
	URL        string
	Secret     string
	BtTrackers string
	Configured bool
}

type QBittorrentConfig struct {
	URL        string
	Username   string
	Password   string
	Configured bool
}

type DownloadTask struct {
	ID          string
	Source      Source
	Destination Destination
	Labels      Labels
	Status      Status
}

func (r DownloadTask) SourceType() string {
	return r.Source.Type
}

func (r DownloadTask) SourceURI() string {
	return r.Source.URI
}

func (r DownloadTask) Name() string {
	return r.Destination.Name
}

func (r DownloadTask) Category() string {
	return r.Labels.Category
}

func (r DownloadTask) Tags() []string {
	return r.Labels.Tags
}

func (r DownloadTask) State() string {
	return r.Status.State
}

func (r DownloadTask) Runtime() *TaskRuntime {
	return r.Status.Runtime
}

type Source struct {
	Type string
	URI  string
}

type Destination struct {
	Name string
}

type Labels struct {
	Category string
	Tags     []string
}

type Status struct {
	State    string
	Progress TaskProgress
	Runtime  *TaskRuntime
}

type TaskProgress struct {
	Download TransferProgress
}

type TransferProgress struct {
	Bytes      int64
	TotalBytes *int64
	Bps        int64
}

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
	InfoHash string
	Path     string
	Snapshot func(context.Context) (SeedSnapshot, error)
	Cleanup  func(context.Context) error
}

type SeedRef struct {
	TaskID   string
	Engine   string
	ID       string
	InfoHash string
	Path     string
}

type SeedSnapshot struct {
	Downloaded int64
	Total      *int64
	Bps        int64
	Runtime    *TaskRuntime
}

type ProgressUpdate struct {
	Downloaded int64
	Total      *int64
	Bps        int64
	Runtime    *TaskRuntime
}

type ProgressReporter func(ProgressUpdate) error

type TaskRuntime struct {
	Engine      string
	Phase       string
	State       string
	Message     string
	UpdatedAt   string
	Progress    *RuntimeProgress
	ETASeconds  *int64
	Connections *int64
	Torrent     *TorrentRuntime
	Seeding     *SeedingRuntime
	Trackers    []Tracker
	Peers       []Peer
	Files       []File
}

type RuntimeProgress struct {
	Download TransferProgress
	Upload   TransferProgress
}

type TorrentRuntime struct {
	InfoHash string
	Name     string
	Seeders  *int64
	Leechers *int64
	Peers    *int64
}

type SeedingRuntime struct {
	Enabled              *bool
	Active               *bool
	UploadedBytes        *int64
	UploadBytesPerSecond *int64
	Ratio                *float64
	StartedAt            string
	ExpiresAt            string
}

type Tracker struct {
	URL      string
	Status   string
	Peers    *int64
	Seeds    *int64
	Leechers *int64
	Message  string
}

type Peer struct {
	Address     string
	Client      string
	CountryCode string
	RegionCode  string
	Progress    *float64
	DownloadBps *int64
	UploadBps   *int64
}

type File struct {
	Path           string
	Size           int64
	CompletedBytes *int64
	Selected       *bool
}

type TaskState string

const (
	TaskStateDownloading TaskState = "downloading"
	TaskStateCompleted   TaskState = "completed"
	TaskStateFailed      TaskState = "failed"
)

type TaskSnapshot struct {
	State      TaskState
	Downloaded int64
	Total      *int64
	Bps        int64
	Runtime    *TaskRuntime
	Result     *Result
	Error      string
}

type Capabilities struct {
	SourceTypes []string
}

type Downloader interface {
	Name() string
	Capabilities() Capabilities
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Check(ctx context.Context) error
	InspectTask(ctx context.Context, task DownloadTask) (TaskSnapshot, bool, error)
	Download(ctx context.Context, task DownloadTask, progress ProgressReporter) (Result, error)
}

type TaskResetter interface {
	ResetTask(ctx context.Context, task DownloadTask) error
}

type SeedRestorer interface {
	RestoreSeed(ctx context.Context, ref SeedRef) (*Seed, error)
}

// SeedLister enumerates every torrent the downloader is currently seeding,
// including ones the worker is no longer tracking. The worker uses this to
// reconcile orphaned seeds so they cannot occupy runtime slots forever.
type SeedLister interface {
	ListSeeds(ctx context.Context) ([]Seed, error)
}
