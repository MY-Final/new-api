package model

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const SystemTaskTypeModelShowcase = "model_showcase"

type ModelShowcasePlan struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	Name            string `json:"name" gorm:"type:varchar(128)"`
	GroupName       string `json:"group" gorm:"type:varchar(64)"`
	Model           string `json:"model" gorm:"type:varchar(255)"`
	Prompt          string `json:"prompt" gorm:"type:text"`
	IntervalMinutes int    `json:"interval_minutes"`
	KeepCount       int    `json:"keep_count"`
	MaxOutputTokens int    `json:"max_output_tokens"`
	TimeoutSeconds  int    `json:"timeout_seconds"`
	Enabled         bool   `json:"enabled"`
	Public          bool   `json:"public"`
	SortOrder       int    `json:"sort_order"`
	NextRunAt       int64  `json:"next_run_at" gorm:"bigint"`
	RunRequested    bool   `json:"run_requested"`
}

type ModelShowcaseRun struct {
	ID               int64  `json:"id" gorm:"primaryKey"`
	PlanID           int    `json:"plan_id" gorm:"index"`
	Name             string `json:"name" gorm:"type:varchar(128)"`
	GroupName        string `json:"group" gorm:"type:varchar(64)"`
	Model            string `json:"model" gorm:"type:varchar(255)"`
	Prompt           string `json:"prompt,omitempty" gorm:"type:text"`
	Output           string `json:"output,omitempty"`
	Status           string `json:"status" gorm:"type:varchar(32)"`
	Error            string `json:"error,omitempty" gorm:"type:text"`
	StartedAt        int64  `json:"started_at" gorm:"bigint"`
	CompletedAt      int64  `json:"completed_at" gorm:"bigint"`
	DurationMS       int64  `json:"duration_ms" gorm:"bigint"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	Quota            int    `json:"-" gorm:"bigint"`
	ChannelID        int    `json:"-"`
}

type ModelShowcaseEntry struct {
	ModelShowcasePlan
	Runs []ModelShowcaseRun `json:"runs"`
}

func (plan *ModelShowcasePlan) Validate() error {
	plan.Name = strings.TrimSpace(plan.Name)
	plan.GroupName = strings.TrimSpace(plan.GroupName)
	plan.Model = strings.TrimSpace(plan.Model)
	plan.Prompt = strings.TrimSpace(plan.Prompt)
	if plan.ID < 0 || plan.Name == "" || utf8.RuneCountInString(plan.Name) > 128 ||
		plan.GroupName == "" || plan.GroupName == "auto" || utf8.RuneCountInString(plan.GroupName) > 64 ||
		plan.Model == "" || utf8.RuneCountInString(plan.Model) > 255 ||
		plan.Prompt == "" || len(plan.Prompt) > 16000 ||
		plan.IntervalMinutes < 1 || plan.IntervalMinutes > 10080 ||
		plan.KeepCount < 1 || plan.KeepCount > 100 ||
		plan.MaxOutputTokens < 128 || plan.MaxOutputTokens > 32768 ||
		plan.TimeoutSeconds < 30 || plan.TimeoutSeconds > 1800 ||
		plan.SortOrder < -100000 || plan.SortOrder > 100000 {
		return common.NewMessage("Invalid showcase plan settings")
	}
	return nil
}

func ListModelShowcase(publicOnly bool) ([]ModelShowcaseEntry, error) {
	plans := []ModelShowcasePlan{}
	query := DB.Order("sort_order, id")
	if publicOnly {
		query = query.Where("public = ?", true)
	}
	if err := query.Find(&plans).Error; err != nil {
		return nil, err
	}
	entries := make([]ModelShowcaseEntry, 0, len(plans))
	for _, plan := range plans {
		runs := []ModelShowcaseRun{}
		if err := DB.Omit("prompt", "output").Where("plan_id = ?", plan.ID).
			Order("id desc").Limit(plan.KeepCount).Find(&runs).Error; err != nil {
			return nil, err
		}
		entries = append(entries, ModelShowcaseEntry{ModelShowcasePlan: plan, Runs: runs})
	}
	return entries, nil
}

func SaveModelShowcasePlan(plan *ModelShowcasePlan) error {
	if err := plan.Validate(); err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if plan.ID == 0 {
			var count int64
			if err := tx.Model(&ModelShowcasePlan{}).Count(&count).Error; err != nil {
				return err
			}
			if count >= 50 {
				return common.NewMessage("At most 50 showcase plans are supported")
			}
			plan.NextRunAt = 0
			plan.RunRequested = false
			return tx.Create(plan).Error
		}
		var stored ModelShowcasePlan
		if err := lockForUpdate(tx).First(&stored, plan.ID).Error; err != nil {
			return err
		}
		intervalChanged := stored.IntervalMinutes != plan.IntervalMinutes
		if err := tx.Model(&stored).Updates(map[string]any{
			"name": plan.Name, "group_name": plan.GroupName, "model": plan.Model, "prompt": plan.Prompt,
			"interval_minutes": plan.IntervalMinutes, "keep_count": plan.KeepCount,
			"max_output_tokens": plan.MaxOutputTokens, "timeout_seconds": plan.TimeoutSeconds,
			"enabled": plan.Enabled, "public": plan.Public, "sort_order": plan.SortOrder,
		}).Error; err != nil {
			return err
		}
		if intervalChanged {
			if err := tx.Model(&stored).Update("next_run_at", 0).Error; err != nil {
				return err
			}
		}
		return pruneModelShowcaseRuns(tx, plan.ID, plan.KeepCount)
	})
}

func DeleteModelShowcasePlan(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var plan ModelShowcasePlan
		if err := lockForUpdate(tx).First(&plan, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if err := tx.Where("plan_id = ?", id).Delete(&ModelShowcaseRun{}).Error; err != nil {
			return err
		}
		return tx.Delete(&ModelShowcasePlan{}, id).Error
	})
}

func RequestModelShowcaseRun(id int) error {
	var plan ModelShowcasePlan
	if err := DB.First(&plan, id).Error; err != nil {
		return err
	}
	return DB.Model(&plan).Update("run_requested", true).Error
}

func StartModelShowcaseRun(ctx context.Context, planID int, promptSuffix string) (*ModelShowcasePlan, *ModelShowcaseRun, error) {
	var plan ModelShowcasePlan
	var run ModelShowcaseRun
	err := DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&plan, planID).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if !plan.RunRequested && (!plan.Enabled || plan.NextRunAt > now) {
			return nil
		}
		if err := plan.Validate(); err != nil {
			return err
		}
		run = ModelShowcaseRun{
			PlanID: plan.ID, Name: plan.Name, GroupName: plan.GroupName, Model: plan.Model,
			Prompt: plan.Prompt + promptSuffix, Status: "running", StartedAt: now,
		}
		if err := tx.Create(&run).Error; err != nil {
			return err
		}
		return tx.Model(&plan).Updates(map[string]any{
			"next_run_at": now + int64(plan.IntervalMinutes)*60, "run_requested": false,
		}).Error
	})
	if err != nil || run.ID == 0 {
		return nil, nil, err
	}
	return &plan, &run, nil
}

func FinishModelShowcaseRun(run *ModelShowcaseRun) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var plan ModelShowcasePlan
		if err := lockForUpdate(tx).First(&plan, run.PlanID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if err := tx.Model(&ModelShowcaseRun{}).Where("id = ? AND status = ?", run.ID, "running").
			Updates(map[string]any{
				"status": run.Status, "output": run.Output, "error": run.Error,
				"completed_at": run.CompletedAt, "duration_ms": run.DurationMS,
				"prompt_tokens": run.PromptTokens, "completion_tokens": run.CompletionTokens,
				"quota": run.Quota, "channel_id": run.ChannelID,
			}).Error; err != nil {
			return err
		}
		return pruneModelShowcaseRuns(tx, plan.ID, plan.KeepCount)
	})
}

func pruneModelShowcaseRuns(tx *gorm.DB, planID, keepCount int) error {
	var ids []int64
	if err := tx.Model(&ModelShowcaseRun{}).Where("plan_id = ? AND status <> ?", planID, "running").
		Order("id desc").Offset(keepCount-1).Limit(1).Pluck("id", &ids).Error; err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	return tx.Where("plan_id = ? AND status <> ? AND id < ?", planID, "running", ids[0]).Delete(&ModelShowcaseRun{}).Error
}
