package restishzpan

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"
)

const checkpointVersion = 1

type checkpoint struct {
	Version       int            `json:"version"`
	API           string         `json:"api"`
	Profile       string         `json:"profile,omitempty"`
	SourcePath    string         `json:"sourcePath"`
	FileSize      int64          `json:"fileSize"`
	ModTimeUnixNS int64          `json:"modTimeUnixNs"`
	ObjectID      string         `json:"objectId"`
	SessionID     string         `json:"sessionId"`
	UploadID      *string        `json:"uploadId"`
	Mode          string         `json:"mode"`
	PartSize      int64          `json:"partSize"`
	PartCount     int            `json:"partCount"`
	Parent        string         `json:"parent"`
	Name          string         `json:"name"`
	Conflict      string         `json:"conflict"`
	Parts         map[int]string `json:"parts"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}

func newCheckpoint(opts uploadOptions, src fileIdentity, matter matterResult, upload uploadInstructions) checkpoint {
	return checkpoint{
		Version:       checkpointVersion,
		API:           opts.API,
		Profile:       opts.Profile,
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      matter.ID,
		SessionID:     upload.SessionID,
		UploadID:      upload.UploadID,
		Mode:          upload.Mode,
		PartSize:      upload.PartSize,
		PartCount:     upload.PartCount,
		Parent:        opts.Parent,
		Name:          opts.Name,
		Conflict:      opts.Conflict,
		Parts:         map[int]string{},
		CreatedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	}
}

func (c checkpoint) completedParts() []completedPart {
	parts := make([]completedPart, 0, len(c.Parts))
	for partNumber, etag := range c.Parts {
		parts = append(parts, completedPart{PartNumber: partNumber, ETag: etag})
	}
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
	return parts
}

type checkpointStore struct {
	dir string
}

func newCheckpointStore(dir string) (checkpointStore, error) {
	if dir == "" {
		cacheDir, err := os.UserCacheDir()
		if err != nil {
			return checkpointStore{}, err
		}
		dir = filepath.Join(cacheDir, "restish-zpan", "checkpoints")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return checkpointStore{}, err
	}
	return checkpointStore{dir: dir}, nil
}

func (s checkpointStore) path(opts uploadOptions, src fileIdentity) string {
	key := opts.API + "\x00" + opts.Profile + "\x00" + src.Path + "\x00" + opts.Parent + "\x00" + opts.Name
	sum := sha256.Sum256([]byte(key))
	return filepath.Join(s.dir, hex.EncodeToString(sum[:])+".json")
}

func (s checkpointStore) load(path string) (checkpoint, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return checkpoint{}, err
	}
	var cp checkpoint
	if err := json.Unmarshal(data, &cp); err != nil {
		return checkpoint{}, err
	}
	if cp.Version != checkpointVersion {
		return checkpoint{}, fmt.Errorf("unsupported checkpoint version %d", cp.Version)
	}
	if cp.Parts == nil {
		cp.Parts = map[int]string{}
	}
	return cp, nil
}

func (s checkpointStore) save(path string, cp checkpoint) error {
	cp.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, ".checkpoint-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if runtime.GOOS != "windows" {
		if err := tmp.Chmod(0o600); err != nil {
			_ = tmp.Close()
			return err
		}
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(tmpName, 0o600); err != nil {
			return err
		}
	}
	return os.Rename(tmpName, path)
}

func (s checkpointStore) remove(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func validateCheckpoint(cp checkpoint, opts uploadOptions, src fileIdentity) error {
	if cp.API != opts.API || cp.Profile != opts.Profile {
		return fmt.Errorf("checkpoint belongs to api/profile %s/%s", cp.API, cp.Profile)
	}
	if cp.SourcePath != src.Path {
		return fmt.Errorf("checkpoint source changed")
	}
	if cp.FileSize != src.Size || cp.ModTimeUnixNS != src.ModTime.UnixNano() {
		return fmt.Errorf("source file changed since checkpoint was created")
	}
	if cp.Parent != opts.Parent || cp.Name != opts.Name || cp.Conflict != opts.Conflict {
		return fmt.Errorf("checkpoint destination or conflict policy differs from this command")
	}
	return nil
}

func validateAbortCheckpoint(cp checkpoint, opts uploadOptions, src fileIdentity) error {
	if cp.API != opts.API || cp.Profile != opts.Profile {
		return fmt.Errorf("checkpoint belongs to api/profile %s/%s", cp.API, cp.Profile)
	}
	if cp.SourcePath != src.Path {
		return fmt.Errorf("checkpoint source changed")
	}
	if cp.Parent != opts.Parent || cp.Name != opts.Name {
		return fmt.Errorf("checkpoint destination differs from this command")
	}
	return nil
}
