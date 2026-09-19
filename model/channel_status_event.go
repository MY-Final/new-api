package model

import (
	"github.com/QuantumNous/new-api/common"
)

// ChannelStatusEvent keeps a lightweight history of channel status changes.
// Channel.other_info only retains the latest reason/time, which is not enough
// to report how often a channel was auto-disabled within a time window.
type ChannelStatusEvent struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	ChannelId int    `json:"channel_id" gorm:"index"`
	Status    int    `json:"status"`
	Reason    string `json:"reason"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

type ChannelAutoDisabledCount struct {
	ChannelId int   `json:"channel_id" gorm:"column:channel_id"`
	Count     int64 `json:"count" gorm:"column:event_count"`
}

func RecordChannelStatusEvent(channelId int, status int, reason string) {
	if channelId <= 0 || status != common.ChannelStatusAutoDisabled {
		return
	}
	event := &ChannelStatusEvent{
		ChannelId: channelId,
		Status:    status,
		Reason:    reason,
		CreatedAt: common.GetTimestamp(),
	}
	if err := DB.Create(event).Error; err != nil {
		common.SysError("failed to record channel status event: " + err.Error())
	}
}

// CountChannelAutoDisabledEvents returns auto-disable occurrences per channel
// for the given window. Channels without occurrences are omitted.
func CountChannelAutoDisabledEvents(start, end int64) (map[int]int64, error) {
	counts := make(map[int]int64)
	var rows []ChannelAutoDisabledCount
	query := DB.Table("channel_status_events").
		Select("channel_id, COUNT(*) AS event_count").
		Where("status = ?", common.ChannelStatusAutoDisabled)
	if start > 0 {
		query = query.Where("created_at >= ?", start)
	}
	if end > 0 {
		query = query.Where("created_at <= ?", end)
	}
	if err := query.Group("channel_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		counts[row.ChannelId] = row.Count
	}
	return counts, nil
}
