package worker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type seedLedgerEntry struct {
	TaskID       string    `json:"taskId"`
	Engine       string    `json:"engine"`
	SeedID       string    `json:"seedId"`
	InfoHash     string    `json:"infoHash,omitempty"`
	Path         string    `json:"path"`
	Size         int64     `json:"size"`
	RetainedAt   time.Time `json:"retainedAt"`
	ExpiresAt    time.Time `json:"expiresAt,omitempty"`
	Downloaded   int64     `json:"downloaded"`
	UploadBase   int64     `json:"uploadBase"`
	SeedDuration string    `json:"seedDuration,omitempty"`
	SeedRatio    float64   `json:"seedRatio,omitempty"`
}

type seedLedger struct {
	Seeds []seedLedgerEntry `json:"seeds"`
}

func seedLedgerPath(stateDir string) string {
	return filepath.Join(stateDir, "seeds.json")
}

func loadSeedLedger(stateDir string) (seedLedger, error) {
	path := seedLedgerPath(stateDir)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return seedLedger{}, nil
		}
		return seedLedger{}, err
	}
	if len(data) == 0 {
		return seedLedger{}, nil
	}
	var ledger seedLedger
	if err := json.Unmarshal(data, &ledger); err != nil {
		return seedLedger{}, err
	}
	return ledger, nil
}

func saveSeedLedger(stateDir string, ledger seedLedger) error {
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(ledger, "", "  ")
	if err != nil {
		return err
	}
	path := seedLedgerPath(stateDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
