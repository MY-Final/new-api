package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/console_setting"
)

var ErrConsoleImagesDisabled = errors.New("Console image uploads are disabled")
var ErrConsoleImageNotFound = errors.New("Console image is not available")

// An upload that was never referenced by a saved announcement must survive
// this long, so in-progress edits are never collected.
const consoleImageGraceSeconds = 3600

// PersistConsoleImage creates the deletion journal before PUT, so a failed
// request or crash never leaves the object untracked in the bucket.
func PersistConsoleImage(ctx context.Context, data []byte, contentType string) (*model.ConsoleImage, error) {
	config := model.TicketStorageConfig()
	if !config.Ready() {
		return nil, ErrConsoleImagesDisabled
	}
	now := common.GetTimestamp()
	image := &model.ConsoleImage{
		ObjectKey:   "console/" + time.Unix(now, 0).UTC().Format("2006/01/02") + "/" + common.GetUUID(),
		Endpoint:    config.Endpoint,
		Bucket:      config.Bucket,
		ContentType: contentType,
		Size:        int64(len(data)),
		CreatedAt:   now,
	}
	if err := model.DB.Create(image).Error; err != nil {
		return nil, err
	}
	response, err := r2StorageRequest(ctx, config, http.MethodPut, image.ObjectKey, contentType, data)
	if err != nil {
		discardConsoleImage(ctx, image)
		return nil, err
	}
	_ = response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardConsoleImage(ctx, image)
		return nil, errors.New("Console image upload failed")
	}
	return image, nil
}

// discardConsoleImage removes a rejected upload. A failed delete stays
// journaled for the scheduled retry instead of leaking the object.
func discardConsoleImage(ctx context.Context, image *model.ConsoleImage) {
	if err := deleteConsoleImage(ctx, *image); err != nil {
		common.SysError("failed to discard console image; scheduled cleanup will retry")
	}
}

func deleteConsoleImage(ctx context.Context, image model.ConsoleImage) error {
	config := model.TicketStorageConfig()
	config.Endpoint, config.Bucket = image.Endpoint, image.Bucket
	response, err := r2StorageRequest(ctx, config, http.MethodDelete, image.ObjectKey, "", nil)
	if err != nil {
		return err
	}
	_ = response.Body.Close()
	if (response.StatusCode < 200 || response.StatusCode >= 300) && response.StatusCode != http.StatusNotFound {
		return errors.New("Console image deletion failed")
	}
	return model.DB.Delete(&image).Error
}

func ReadConsoleImage(ctx context.Context, image *model.ConsoleImage) ([]byte, error) {
	config := model.TicketStorageConfig()
	config.Endpoint, config.Bucket = image.Endpoint, image.Bucket
	response, err := r2StorageRequest(ctx, config, http.MethodGet, image.ObjectKey, "", nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, ErrConsoleImageNotFound
	}
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("Console image retrieval failed")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 5*1024*1024+1))
	if err != nil || int64(len(data)) != image.Size {
		return nil, errors.New("Console image retrieval failed")
	}
	return data, nil
}

// CleanupConsoleImages deletes images that no announcement references. New
// uploads are skipped until the grace window passes.
func CleanupConsoleImages(ctx context.Context) error {
	referenced := referencedConsoleImageIDs()
	var failures []error
	for cursor := 0; ; {
		if err := ctx.Err(); err != nil {
			return err
		}
		images, err := model.ListConsoleImagesBefore(common.GetTimestamp()-consoleImageGraceSeconds, cursor)
		if err != nil {
			return err
		}
		for _, image := range images {
			cursor = image.ID
			if referenced[image.ID] {
				continue
			}
			if err := deleteConsoleImage(ctx, image); err != nil {
				failures = append(failures, err)
			}
		}
		if len(images) < 100 {
			break
		}
	}
	return errors.Join(failures...)
}

func referencedConsoleImageIDs() map[int]bool {
	ids := make(map[int]bool)
	for _, announcement := range console_setting.GetAnnouncements() {
		images, ok := announcement["images"].([]any)
		if !ok {
			continue
		}
		for _, value := range images {
			if id, ok := value.(float64); ok && id > 0 {
				ids[int(id)] = true
			}
		}
	}
	return ids
}

func StartConsoleImageCleanup() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			if err := CleanupConsoleImages(ctx); err != nil {
				common.SysError("console image cleanup failed; will retry")
			}
			cancel()
			<-ticker.C
		}
	}()
}
