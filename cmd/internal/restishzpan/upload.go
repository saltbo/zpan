package restishzpan

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

type uploadOptions struct {
	API           string
	Profile       string
	Source        string
	Parent        string
	Name          string
	Conflict      string
	Concurrency   int
	Resume        bool
	Abort         bool
	CheckpointDir string
	ContentType   string
}

type fileIdentity struct {
	Path    string
	Size    int64
	ModTime time.Time
}

func Run(startupArgs, args []string, h host) error {
	if wantsHelp(args) {
		return h.Response(200, nil, map[string]any{
			"usage": "restish zpan-upload [flags] SOURCE [DESTINATION]",
			"examples": []string{
				"RSH_PROFILE=file-manager restish zpan-upload --api zpan --profile file-manager ./photo.jpg",
				"RSH_PROFILE=ci restish zpan-upload --api zpan --profile ci --parent folder-id ./photo.jpg report.jpg",
				"RSH_PROFILE=file-manager restish zpan-upload --api zpan --profile file-manager --resume ./large.bin",
				"RSH_PROFILE=file-manager restish zpan-upload --api zpan --profile file-manager --abort ./large.bin",
			},
		})
	}
	opts, err := parseOptions(args)
	if err != nil {
		return err
	}
	_ = startupArgs
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runWithStorage(ctx, opts, h, newHTTPStorageClient())
}

func wantsHelp(args []string) bool {
	for _, arg := range args {
		if arg == "-h" || arg == "--help" {
			return true
		}
	}
	return false
}

func parseOptions(args []string) (uploadOptions, error) {
	opts := uploadOptions{API: "zpan", Conflict: "fail", Concurrency: 4}
	fs := flag.NewFlagSet("zpan-upload", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&opts.API, "api", opts.API, "Restish API name")
	fs.StringVar(&opts.Profile, "profile", "", "Restish profile name")
	fs.StringVar(&opts.Parent, "parent", "", "destination folder/object parent")
	fs.StringVar(&opts.Parent, "folder", "", "destination folder/object parent")
	fs.StringVar(&opts.Name, "name", "", "destination object name")
	fs.StringVar(&opts.Conflict, "conflict", opts.Conflict, "conflict policy: fail, rename, replace")
	fs.IntVar(&opts.Concurrency, "concurrency", opts.Concurrency, "maximum concurrent part uploads")
	fs.BoolVar(&opts.Resume, "resume", false, "resume an interrupted upload from the local checkpoint")
	fs.BoolVar(&opts.Abort, "abort", false, "abort the checkpointed upload session and delete the local checkpoint")
	fs.StringVar(&opts.CheckpointDir, "checkpoint-dir", "", "checkpoint directory")
	fs.StringVar(&opts.ContentType, "content-type", "", "override detected content type")
	if err := fs.Parse(args); err != nil {
		return uploadOptions{}, err
	}
	if opts.API == "" {
		return uploadOptions{}, fmt.Errorf("--api is required")
	}
	if opts.Concurrency < 1 || opts.Concurrency > 32 {
		return uploadOptions{}, fmt.Errorf("--concurrency must be between 1 and 32")
	}
	if opts.Conflict != "fail" && opts.Conflict != "rename" && opts.Conflict != "replace" {
		return uploadOptions{}, fmt.Errorf("--conflict must be fail, rename, or replace")
	}
	positional := fs.Args()
	if len(positional) < 1 || len(positional) > 2 {
		return uploadOptions{}, fmt.Errorf("usage: restish zpan-upload [flags] SOURCE [DESTINATION]")
	}
	opts.Source = positional[0]
	if opts.Name == "" {
		opts.Name = filepath.Base(opts.Source)
	}
	if len(positional) == 2 {
		parent, name := splitDestination(positional[1], opts.Name)
		if opts.Parent == "" {
			opts.Parent = parent
		}
		if name != "" {
			opts.Name = name
		}
	}
	return opts, nil
}

func splitDestination(dest, fallbackName string) (string, string) {
	dest = filepath.ToSlash(strings.TrimSpace(dest))
	if dest == "" {
		return "", fallbackName
	}
	if strings.HasSuffix(dest, "/") {
		return strings.TrimSuffix(dest, "/"), fallbackName
	}
	parent, name := filepath.Split(dest)
	return strings.TrimSuffix(filepath.ToSlash(parent), "/"), name
}

func runWithStorage(ctx context.Context, opts uploadOptions, h host, storage storageClient) error {
	store, err := newCheckpointStore(opts.CheckpointDir)
	if err != nil {
		return err
	}
	if opts.Abort {
		src, err := sourcePathIdentity(opts.Source)
		if err != nil {
			return err
		}
		checkpointPath := store.path(opts, src)
		ops, err := fetchOperations(ctx, h, opts.API, opts.Profile)
		if err != nil {
			return err
		}
		return abortCheckpoint(ctx, opts, h, store, checkpointPath, src, ops)
	}
	src, err := statSource(opts.Source)
	if err != nil {
		return err
	}
	if opts.ContentType == "" {
		opts.ContentType = detectContentType(src.Path)
	}
	checkpointPath := store.path(opts, src)
	ops, err := fetchOperations(ctx, h, opts.API, opts.Profile)
	if err != nil {
		return err
	}
	cp, initialParts, err := prepareUpload(ctx, opts, h, store, checkpointPath, src, ops)
	if err != nil {
		return err
	}
	if err := uploadMissingParts(ctx, opts, h, storage, store, checkpointPath, src, ops, &cp, initialParts); err != nil {
		return err
	}
	object, err := completeUpload(ctx, opts, h, ops, cp)
	if err != nil {
		return err
	}
	if err := store.remove(checkpointPath); err != nil {
		return err
	}
	return h.Response(200, nil, uploadResult{
		Object: object,
		Upload: resultUpload{
			API:       opts.API,
			Profile:   opts.Profile,
			SessionID: cp.SessionID,
			Mode:      cp.Mode,
			PartSize:  cp.PartSize,
			PartCount: cp.PartCount,
			Parts:     cp.completedParts(),
		},
		CompletedAt: time.Now().UTC(),
	})
}

func statSource(path string) (fileIdentity, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fileIdentity{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return fileIdentity{}, err
	}
	if info.IsDir() {
		return fileIdentity{}, fmt.Errorf("source must be a file: %s", abs)
	}
	return fileIdentity{Path: abs, Size: info.Size(), ModTime: info.ModTime()}, nil
}

func sourcePathIdentity(path string) (fileIdentity, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fileIdentity{}, err
	}
	return fileIdentity{Path: abs}, nil
}

func detectContentType(path string) string {
	return mime.TypeByExtension(filepath.Ext(path))
}

func prepareUpload(ctx context.Context, opts uploadOptions, h host, store checkpointStore, checkpointPath string, src fileIdentity, ops operationSet) (checkpoint, []uploadPart, error) {
	if opts.Resume {
		cp, err := store.load(checkpointPath)
		if err != nil {
			return checkpoint{}, nil, err
		}
		if err := validateCheckpoint(cp, opts, src); err != nil {
			return checkpoint{}, nil, err
		}
		return cp, nil, nil
	}
	body := map[string]any{
		"name":       opts.Name,
		"size":       src.Size,
		"parent":     opts.Parent,
		"onConflict": opts.Conflict,
	}
	if opts.ContentType != "" {
		body["type"] = opts.ContentType
	}
	resp, err := h.Do(&plugin.HTTPRequestMsg{
		Method:      ops.Create.Method,
		URI:         opts.API + ops.Create.Path,
		Body:        body,
		ContentType: "application/json",
		NoCache:     true,
		Timeout:     60,
	})
	if err != nil {
		return checkpoint{}, nil, err
	}
	matter, err := decodeBody[matterResult](resp)
	if err != nil {
		return checkpoint{}, nil, err
	}
	if matter.Upload == nil {
		return checkpoint{}, nil, fmt.Errorf("createObject did not return upload instructions for file draft")
	}
	cp := newCheckpoint(opts, src, matter, *matter.Upload)
	if err := store.save(checkpointPath, cp); err != nil {
		return checkpoint{}, nil, err
	}
	return cp, matter.Upload.Parts, nil
}

func uploadMissingParts(ctx context.Context, opts uploadOptions, h host, storage storageClient, store checkpointStore, checkpointPath string, src fileIdentity, ops operationSet, cp *checkpoint, initialParts []uploadPart) error {
	missing := missingPartNumbers(*cp)
	parts, err := currentParts(ctx, opts, h, ops, *cp, missing, initialParts)
	if err != nil {
		return err
	}
	partByNumber := map[int]uploadPart{}
	for _, part := range parts {
		partByNumber[part.PartNumber] = part
	}
	work := make(chan int)
	errs := make(chan error, 1)
	var mu sync.Mutex
	var wg sync.WaitGroup
	workers := min(opts.Concurrency, cp.PartCount)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for partNumber := range work {
				part := partByNumber[partNumber]
				etag, err := putPartWithRetry(ctx, opts, h, storage, ops, *cp, src, part)
				if err != nil {
					select {
					case errs <- err:
					default:
					}
					continue
				}
				mu.Lock()
				cp.Parts[partNumber] = etag
				saveErr := store.save(checkpointPath, *cp)
				mu.Unlock()
				if saveErr != nil {
					select {
					case errs <- saveErr:
					default:
					}
				}
				_ = h.Progress(fmt.Sprintf("uploaded part %d/%d", partNumber, cp.PartCount))
			}
		}()
	}
	for _, partNumber := range missing {
		select {
		case <-ctx.Done():
			close(work)
			wg.Wait()
			return ctx.Err()
		case err := <-errs:
			close(work)
			wg.Wait()
			return err
		case work <- partNumber:
		}
	}
	close(work)
	wg.Wait()
	select {
	case err := <-errs:
		return err
	default:
		return nil
	}
}

func currentParts(ctx context.Context, opts uploadOptions, h host, ops operationSet, cp checkpoint, partNumbers []int, initialParts []uploadPart) ([]uploadPart, error) {
	if len(partNumbers) == 0 {
		return nil, nil
	}
	if len(initialParts) > 0 {
		byNumber := map[int]uploadPart{}
		for _, part := range initialParts {
			byNumber[part.PartNumber] = part
		}
		parts := make([]uploadPart, 0, len(partNumbers))
		for _, partNumber := range partNumbers {
			part, ok := byNumber[partNumber]
			if !ok {
				return nil, fmt.Errorf("createObject did not return upload instructions for part %d", partNumber)
			}
			parts = append(parts, part)
		}
		return parts, nil
	}
	return resignParts(ctx, opts, h, ops, cp, partNumbers)
}

func putPartWithRetry(ctx context.Context, opts uploadOptions, h host, storage storageClient, ops operationSet, cp checkpoint, src fileIdentity, part uploadPart) (string, error) {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if part.URL == "" || expiresSoon(part.ExpiresAt, time.Now()) {
			parts, err := resignParts(ctx, opts, h, ops, cp, []int{part.PartNumber})
			if err != nil {
				return "", err
			}
			if len(parts) != 1 || parts[0].PartNumber != part.PartNumber {
				return "", fmt.Errorf("re-sign response missing part %d", part.PartNumber)
			}
			part = parts[0]
		}
		etag, err := putPart(ctx, storage, src, cp.PartSize, part)
		if err == nil {
			return etag, nil
		}
		lastErr = err
		if shouldResignAfterStorageError(err) {
			part.URL = ""
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(time.Duration(attempt) * 200 * time.Millisecond):
		}
	}
	return "", lastErr
}

func putPart(ctx context.Context, storage storageClient, src fileIdentity, partSize int64, part uploadPart) (string, error) {
	file, err := os.Open(src.Path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	offset, size := partRange(src.Size, partSize, part.PartNumber)
	reader := io.NewSectionReader(file, offset, size)
	return storage.PutPart(ctx, part, reader, size)
}

func partRange(fileSize, partSize int64, partNumber int) (int64, int64) {
	if fileSize == 0 {
		return 0, 0
	}
	offset := int64(partNumber-1) * partSize
	size := partSize
	if remaining := fileSize - offset; remaining < size {
		size = remaining
	}
	return offset, size
}

func missingPartNumbers(cp checkpoint) []int {
	missing := make([]int, 0, cp.PartCount-len(cp.Parts))
	for i := 1; i <= cp.PartCount; i++ {
		if cp.Parts[i] == "" {
			missing = append(missing, i)
		}
	}
	return missing
}

func resignParts(ctx context.Context, opts uploadOptions, h host, ops operationSet, cp checkpoint, partNumbers []int) ([]uploadPart, error) {
	var all []uploadPart
	for start := 0; start < len(partNumbers); start += 100 {
		end := min(start+100, len(partNumbers))
		parts, err := resignPartBatch(ctx, opts, h, ops, cp, partNumbers[start:end])
		if err != nil {
			return nil, err
		}
		all = append(all, parts...)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].PartNumber < all[j].PartNumber })
	seen := map[int]bool{}
	for _, part := range all {
		seen[part.PartNumber] = true
	}
	for _, partNumber := range partNumbers {
		if !seen[partNumber] {
			return nil, fmt.Errorf("re-sign response missing part %d", partNumber)
		}
	}
	return all, nil
}

func resignPartBatch(ctx context.Context, opts uploadOptions, h host, ops operationSet, cp checkpoint, partNumbers []int) ([]uploadPart, error) {
	resp, err := h.Do(&plugin.HTTPRequestMsg{
		Method:      ops.Presign.Method,
		URI:         opts.API + expandUploadPath(ops.Presign.Path, cp),
		Body:        map[string]any{"partNumbers": partNumbers},
		ContentType: "application/json",
		NoCache:     true,
		Timeout:     60,
	})
	if err != nil {
		return nil, err
	}
	_ = ctx
	result, err := decodeBody[presignPartsResult](resp)
	if err != nil {
		return nil, err
	}
	sort.Slice(result.Parts, func(i, j int) bool { return result.Parts[i].PartNumber < result.Parts[j].PartNumber })
	return result.Parts, nil
}

func completeUpload(ctx context.Context, opts uploadOptions, h host, ops operationSet, cp checkpoint) (matterResult, error) {
	parts := cp.completedParts()
	if len(parts) != cp.PartCount {
		return matterResult{}, fmt.Errorf("cannot complete: %d of %d parts uploaded", len(parts), cp.PartCount)
	}
	resp, err := h.Do(&plugin.HTTPRequestMsg{
		Method:      ops.Complete.Method,
		URI:         opts.API + expandUploadPath(ops.Complete.Path, cp),
		Body:        map[string]any{"parts": parts},
		ContentType: "application/json",
		NoCache:     true,
		Timeout:     120,
	})
	if err != nil {
		return matterResult{}, err
	}
	_ = ctx
	return decodeBody[matterResult](resp)
}

func abortCheckpoint(ctx context.Context, opts uploadOptions, h host, store checkpointStore, checkpointPath string, src fileIdentity, ops operationSet) error {
	cp, err := store.load(checkpointPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("no checkpoint found for %s", src.Path)
		}
		return err
	}
	if err := validateAbortCheckpoint(cp, opts, src); err != nil {
		return err
	}
	resp, err := h.Do(&plugin.HTTPRequestMsg{
		Method:  ops.Abort.Method,
		URI:     opts.API + expandUploadPath(ops.Abort.Path, cp),
		NoCache: true,
		Timeout: 60,
	})
	if err != nil {
		return err
	}
	if _, err := decodeBody[map[string]any](resp); err != nil && resp.Status != 204 {
		return err
	}
	if err := store.remove(checkpointPath); err != nil {
		return err
	}
	_ = ctx
	return h.Response(200, nil, map[string]any{
		"aborted":   true,
		"api":       opts.API,
		"profile":   opts.Profile,
		"objectId":  cp.ObjectID,
		"sessionId": cp.SessionID,
	})
}

func expandUploadPath(path string, cp checkpoint) string {
	out := strings.ReplaceAll(path, "{id}", cp.ObjectID)
	out = strings.ReplaceAll(out, "{uploadSessionId}", cp.SessionID)
	return out
}
