package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

var ErrTicketImagesDisabled = errors.New("Ticket image uploads are disabled")
var ErrTicketImageExpired = errors.New("Ticket image has expired")

// Never follow a redirect with R2 authorization headers. Credentials stay on
// the configured Cloudflare host; all object access uses AWS's SigV4 signer.
var ticketR2Client = &http.Client{Timeout: time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func ticketR2Request(ctx context.Context, config system_setting.TicketStorageConfig, method, key, contentType string, data []byte) (*http.Response, error) {
	if !config.Ready() {
		return nil, errors.New("Ticket image storage is unavailable")
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimSuffix(config.Endpoint, "/")+"/"+config.Bucket+"/"+key, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	request.Header.Set("Cache-Control", "private, no-store")
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	request.Header.Set("X-Amz-Content-Sha256", hash)
	err = v4.NewSigner().SignHTTP(ctx, aws.Credentials{AccessKeyID: config.AccessKey, SecretAccessKey: config.SecretKey}, request, hash, "s3", "auto", time.Now())
	if err != nil {
		return nil, errors.New("Ticket image storage signing failed")
	}
	response, err := ticketR2Client.Do(request)
	if err != nil {
		return nil, errors.New("Ticket image storage request failed")
	}
	return response, nil
}

// PersistTicketImages creates the deletion journal before PUT. It clears Data
// before model persistence, so new image bytes never enter the database.
func PersistTicketImages(ctx context.Context, message *model.TicketMessage) ([]model.TicketStoredObject, error) {
	objects := make([]model.TicketStoredObject, 0, len(message.Attachments))
	if len(message.Attachments) == 0 {
		return objects, nil
	}
	config := model.TicketStorageConfig()
	if !config.Enabled || !config.Ready() {
		return objects, ErrTicketImagesDisabled
	}
	now := common.GetTimestamp()
	for i := range message.Attachments {
		attachment := &message.Attachments[i]
		object := model.TicketStoredObject{ObjectKey: "tickets/" + time.Unix(now, 0).UTC().Format("2006/01/02") + "/" + common.GetUUID(), CreatedAt: now, ExpiresAt: now + int64(config.RetentionDays)*86400, Endpoint: config.Endpoint, Bucket: config.Bucket}
		if err := model.DB.Create(&object).Error; err != nil {
			return objects, err
		}
		objects = append(objects, object)
		response, err := ticketR2Request(ctx, config, http.MethodPut, object.ObjectKey, attachment.ContentType, attachment.Data)
		if err != nil {
			return objects, err
		}
		_ = response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return objects, errors.New("Ticket image upload failed")
		}
		attachment.Size = int64(len(attachment.Data))
		attachment.Data = nil
		attachment.ObjectKey, attachment.CreatedAt, attachment.ExpiresAt = object.ObjectKey, now, object.ExpiresAt
		attachment.Endpoint, attachment.Bucket = config.Endpoint, config.Bucket
	}
	return objects, nil
}

// DiscardTicketImages handles rejected and duplicate submissions. Failed
// deletes stay journaled for the scheduled retry instead of being forgotten.
func DiscardTicketImages(objects []model.TicketStoredObject) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	for _, object := range objects {
		if err := deleteTicketObject(ctx, object); err != nil {
			common.SysError("failed to discard ticket image; scheduled cleanup will retry")
		}
	}
}

func deleteTicketObject(ctx context.Context, object model.TicketStoredObject) error {
	config := model.TicketStorageConfig()
	config.Endpoint, config.Bucket = object.Endpoint, object.Bucket
	response, err := ticketR2Request(ctx, config, http.MethodDelete, object.ObjectKey, "", nil)
	if err != nil {
		return err
	}
	_ = response.Body.Close()
	if (response.StatusCode < 200 || response.StatusCode >= 300) && response.StatusCode != http.StatusNotFound {
		return errors.New("Ticket image deletion failed")
	}
	return model.CompleteTicketObjectDeletion(object)
}

func ReadTicketImage(ctx context.Context, attachment *model.TicketAttachment) ([]byte, error) {
	if attachment.ExpiresAt <= common.GetTimestamp() {
		return nil, ErrTicketImageExpired
	}
	// Compatibility only: existing DB images are moved to R2 by cleanup.
	if len(attachment.Data) > 0 {
		return attachment.Data, nil
	}
	if attachment.ObjectKey == "" {
		return nil, ErrTicketImageExpired
	}
	config := model.TicketStorageConfig()
	config.Endpoint, config.Bucket = attachment.Endpoint, attachment.Bucket
	response, err := ticketR2Request(ctx, config, http.MethodGet, attachment.ObjectKey, "", nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, ErrTicketImageExpired
	}
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("Ticket image retrieval failed")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 5*1024*1024+1))
	if err != nil || int64(len(data)) != attachment.Size {
		return nil, errors.New("Ticket image retrieval failed")
	}
	// Do not release an image if its lifetime elapsed during the GET.
	if attachment.ExpiresAt <= common.GetTimestamp() {
		return nil, ErrTicketImageExpired
	}
	return data, nil
}

func CleanupTicketImages(ctx context.Context) error {
	now := common.GetTimestamp()
	// Expired legacy bytes are removed even when uploads/R2 are disabled.
	if err := model.DB.Model(&model.TicketAttachment{}).Where("expires_at <= ? AND data IS NOT NULL", now).Update("data", nil).Error; err != nil {
		return err
	}
	var failures []error
	for cursor := 0; ; {
		if err := ctx.Err(); err != nil {
			return err
		}
		objects, err := model.TicketObjectsDue(now, cursor)
		if err != nil {
			return err
		}
		for _, object := range objects {
			if err := deleteTicketObject(ctx, object); err != nil {
				failures = append(failures, err)
			}
			cursor = object.ID
		}
		if len(objects) < 100 {
			break
		}
	}
	config := model.TicketStorageConfig()
	if !config.Ready() {
		return errors.Join(failures...)
	}
	// Migrate live legacy bytes only after PUT and a byte-for-byte verification.
	var legacy []model.TicketAttachment
	if err := model.DB.Where("data IS NOT NULL AND expires_at > ?", now).Order("id ASC").Limit(10).Find(&legacy).Error; err != nil {
		return err
	}
	for _, attachment := range legacy {
		object := model.TicketStoredObject{ObjectKey: "tickets/" + time.Unix(now, 0).UTC().Format("2006/01/02") + "/" + common.GetUUID(), CreatedAt: now, ExpiresAt: attachment.ExpiresAt, Endpoint: config.Endpoint, Bucket: config.Bucket}
		if err := model.DB.Create(&object).Error; err != nil {
			return err
		}
		response, err := ticketR2Request(ctx, config, http.MethodPut, object.ObjectKey, attachment.ContentType, attachment.Data)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		_ = response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			failures = append(failures, errors.New("Legacy ticket image upload failed"))
			continue
		}
		copy := attachment
		copy.Data, copy.ObjectKey, copy.Size = nil, object.ObjectKey, int64(len(attachment.Data))
		copy.Endpoint, copy.Bucket = config.Endpoint, config.Bucket
		verified, err := ReadTicketImage(ctx, &copy)
		if err != nil || !bytes.Equal(verified, attachment.Data) {
			failures = append(failures, errors.New("Legacy ticket image verification failed"))
			continue
		}
		result := model.DB.Model(&model.TicketAttachment{}).Where("id = ? AND data IS NOT NULL AND expires_at > ?", attachment.ID, common.GetTimestamp()).Updates(map[string]any{"data": nil, "object_key": object.ObjectKey, "endpoint": config.Endpoint, "bucket": config.Bucket, "size": copy.Size})
		if result.Error != nil {
			failures = append(failures, result.Error)
		}
	}
	return errors.Join(failures...)
}

func StartTicketImageCleanup() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			if err := CleanupTicketImages(ctx); err != nil {
				common.SysError("ticket image cleanup failed; will retry")
			}
			cancel()
			<-ticker.C
		}
	}()
}
