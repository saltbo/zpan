package downloader

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type attemptLedger struct {
	Attempts map[string]int `json:"attempts"`
}

func attemptLedgerPath(stateDir string) string {
	return filepath.Join(stateDir, "attempts.json")
}

func loadAttemptLedger(stateDir string) (attemptLedger, error) {
	path := attemptLedgerPath(stateDir)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return attemptLedger{Attempts: map[string]int{}}, nil
		}
		return attemptLedger{}, err
	}
	if len(data) == 0 {
		return attemptLedger{Attempts: map[string]int{}}, nil
	}
	var ledger attemptLedger
	if err := json.Unmarshal(data, &ledger); err != nil {
		return attemptLedger{}, err
	}
	if ledger.Attempts == nil {
		ledger.Attempts = map[string]int{}
	}
	return ledger, nil
}

func saveAttemptLedger(stateDir string, ledger attemptLedger) error {
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return err
	}
	if ledger.Attempts == nil {
		ledger.Attempts = map[string]int{}
	}
	data, err := json.MarshalIndent(ledger, "", "  ")
	if err != nil {
		return err
	}
	path := attemptLedgerPath(stateDir)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
