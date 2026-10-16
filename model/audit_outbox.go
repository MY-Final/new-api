package model

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

var auditReplayMu sync.Mutex

// Failed writes are retained under --log-dir/audit-pending with owner-only
// permissions. Mount log-dir on persistent storage to survive container removal.
func queueAuditLog(entry AuditLog) error {
	data, err := common.Marshal(entry)
	if err != nil {
		return err
	}
	dir := filepath.Join(*common.LogDir, "audit-pending")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".pending-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(file.Name(), filepath.Join(dir, AccessTokenFingerprint(entry.EventId)+".json")); err != nil {
		return err
	}
	directory, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

// FlushPendingAuditLogs is bounded and idempotent by event_id. A failed replay
// keeps its file for the next pass, including across process restarts.
func FlushPendingAuditLogs(limit int) error {
	auditReplayMu.Lock()
	defer auditReplayMu.Unlock()
	dir := filepath.Join(*common.LogDir, "audit-pending")
	files, err := os.Open(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer files.Close()
	var replayErr error
	processed := 0
	for processed < max(1, limit) {
		entries, err := files.ReadDir(max(1, limit-processed))
		if err != nil && !errors.Is(err, io.EOF) {
			return errors.Join(replayErr, err)
		}
		if len(entries) == 0 {
			break
		}
		for _, file := range entries {
			if !file.Type().IsRegular() || !strings.HasSuffix(file.Name(), ".json") {
				continue
			}
			processed++
			path := filepath.Join(dir, file.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			var entry AuditLog
			if err := common.Unmarshal(data, &entry); err != nil || entry.EventId == "" {
				// Retain malformed events for inspection without blocking healthy ones.
				quarantine := filepath.Join(dir, "quarantine")
				if err := os.MkdirAll(quarantine, 0700); err != nil {
					return errors.Join(replayErr, err)
				}
				if err := os.Rename(path, filepath.Join(quarantine, file.Name())); err != nil {
					return errors.Join(replayErr, err)
				}
				replayErr = errors.Join(replayErr, fmt.Errorf("invalid audit recovery file quarantined: %s", file.Name()))
				continue
			}
			if err := insertAuditLog(&entry); err != nil {
				return err
			}
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return replayErr
}

func RetryAuditLogs() {
	for {
		if err := FlushPendingAuditLogs(100); err != nil {
			common.SysError(common.LogText("audit log recovery failed: %v", err))
		}
		time.Sleep(30 * time.Second)
	}
}
