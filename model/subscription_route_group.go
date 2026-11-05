package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	MaxSubscriptionRouteGroups = 32
)

type SubscriptionPlanRouteGroup struct {
	Id        int    `json:"id"`
	PlanId    int    `json:"plan_id" gorm:"index;not null;uniqueIndex:idx_subscription_plan_route_group,priority:1"`
	GroupName string `json:"group_name" gorm:"type:varchar(64);not null;uniqueIndex:idx_subscription_plan_route_group,priority:2"`
	SortOrder int    `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint"`
}

func (g *SubscriptionPlanRouteGroup) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	g.CreatedAt = now
	g.UpdatedAt = now
	return nil
}

func (g *SubscriptionPlanRouteGroup) BeforeUpdate(tx *gorm.DB) error {
	g.UpdatedAt = common.GetTimestamp()
	return nil
}

type UserSubscriptionRouteGroup struct {
	Id                 int    `json:"id"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"index;not null;uniqueIndex:idx_user_subscription_route_group,priority:1"`
	GroupName          string `json:"group_name" gorm:"type:varchar(64);not null;uniqueIndex:idx_user_subscription_route_group,priority:2"`
	SortOrder          int    `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint"`
}

func (g *UserSubscriptionRouteGroup) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	g.CreatedAt = now
	g.UpdatedAt = now
	return nil
}

func (g *UserSubscriptionRouteGroup) BeforeUpdate(tx *gorm.DB) error {
	g.UpdatedAt = common.GetTimestamp()
	return nil
}

func NormalizeSubscriptionRouteGroups(groups []string) ([]string, error) {
	if len(groups) > MaxSubscriptionRouteGroups {
		return nil, fmt.Errorf("at most %d route groups are allowed", MaxSubscriptionRouteGroups)
	}
	result := make([]string, 0, len(groups))
	seen := make(map[string]struct{}, len(groups))
	for _, raw := range groups {
		group := strings.TrimSpace(raw)
		if group == "" {
			return nil, errors.New("subscription route group cannot be empty")
		}
		if len(group) > 64 {
			return nil, errors.New("subscription route group must not exceed 64 characters")
		}
		if group == "auto" {
			return nil, errors.New("auto cannot be used as a subscription route group")
		}
		if _, exists := seen[group]; exists {
			continue
		}
		seen[group] = struct{}{}
		result = append(result, group)
	}
	return result, nil
}

func ReplaceSubscriptionPlanRouteGroupsTx(tx *gorm.DB, planId int, groups []string) error {
	if tx == nil || planId <= 0 {
		return errors.New("invalid plan route groups args")
	}
	normalized, err := NormalizeSubscriptionRouteGroups(groups)
	if err != nil {
		return err
	}
	if err := tx.Where("plan_id = ?", planId).Delete(&SubscriptionPlanRouteGroup{}).Error; err != nil {
		return err
	}
	if len(normalized) == 0 {
		return nil
	}
	rows := make([]SubscriptionPlanRouteGroup, 0, len(normalized))
	for index, group := range normalized {
		rows = append(rows, SubscriptionPlanRouteGroup{
			PlanId:    planId,
			GroupName: group,
			SortOrder: index,
		})
	}
	return tx.Create(&rows).Error
}

func LoadSubscriptionPlanRouteGroupsTx(tx *gorm.DB, plan *SubscriptionPlan) error {
	if plan == nil || plan.Id <= 0 {
		return errors.New("invalid subscription plan")
	}
	if tx == nil {
		tx = DB
	}
	var rows []SubscriptionPlanRouteGroup
	if err := tx.Where("plan_id = ?", plan.Id).
		Order("sort_order asc, group_name asc, id asc").
		Find(&rows).Error; err != nil {
		return err
	}
	plan.RouteGroups = make([]string, 0, len(rows))
	for _, row := range rows {
		plan.RouteGroups = append(plan.RouteGroups, row.GroupName)
	}
	plan.NormalizeDefaults()
	return nil
}

func HydrateSubscriptionPlansRouteGroups(plans []SubscriptionPlan) error {
	for index := range plans {
		if err := LoadSubscriptionPlanRouteGroupsTx(nil, &plans[index]); err != nil {
			return err
		}
	}
	return nil
}

func SnapshotPlanRouteGroupsTx(tx *gorm.DB, subscriptionId int, groups []string) error {
	if tx == nil || subscriptionId <= 0 {
		return errors.New("invalid subscription route group snapshot args")
	}
	normalized, err := NormalizeSubscriptionRouteGroups(groups)
	if err != nil {
		return err
	}
	if len(normalized) == 0 {
		return nil
	}
	rows := make([]UserSubscriptionRouteGroup, 0, len(normalized))
	for index, group := range normalized {
		rows = append(rows, UserSubscriptionRouteGroup{
			UserSubscriptionId: subscriptionId,
			GroupName:          group,
			SortOrder:          index,
		})
	}
	return tx.Create(&rows).Error
}

func LoadUserSubscriptionRouteGroupsTx(tx *gorm.DB, subscriptionId int) ([]string, error) {
	if subscriptionId <= 0 {
		return nil, errors.New("invalid user subscription id")
	}
	if tx == nil {
		tx = DB
	}
	var rows []UserSubscriptionRouteGroup
	if err := tx.Where("user_subscription_id = ?", subscriptionId).
		Order("sort_order asc, group_name asc, id asc").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	groups := make([]string, 0, len(rows))
	for _, row := range rows {
		groups = append(groups, row.GroupName)
	}
	return groups, nil
}

func HydrateUserSubscriptionRouteGroups(subscription *UserSubscription) error {
	if subscription == nil || subscription.Id <= 0 {
		return errors.New("invalid user subscription")
	}
	groups, err := LoadUserSubscriptionRouteGroupsTx(nil, subscription.Id)
	if err != nil {
		return err
	}
	subscription.RouteGroups = groups
	return nil
}

func GetActiveSubscriptionRouteGroups(userId int) ([]string, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	now := common.GetTimestamp()
	var subscriptions []UserSubscription
	if err := DB.Select("id").
		Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Order("end_time desc, id desc").
		Find(&subscriptions).Error; err != nil {
		return nil, err
	}
	if len(subscriptions) == 0 {
		return []string{}, nil
	}
	ids := make([]int, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		ids = append(ids, subscription.Id)
	}
	var rows []UserSubscriptionRouteGroup
	if err := DB.Where("user_subscription_id IN ?", ids).
		Order("sort_order asc, group_name asc, id asc").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	groups := make([]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		if _, exists := seen[row.GroupName]; exists {
			continue
		}
		seen[row.GroupName] = struct{}{}
		groups = append(groups, row.GroupName)
	}
	return groups, nil
}

// GetActiveSubscriptionForRoute loads the active budget and output-limit
// snapshot used before pricing and forwarding one request.
func GetActiveSubscriptionForRoute(userId int, groupName string) (*UserSubscription, error) {
	if userId <= 0 || strings.TrimSpace(groupName) == "" {
		return nil, nil
	}
	if DB == nil {
		return nil, errors.New("subscription database is unavailable")
	}
	ids := DB.Model(&UserSubscriptionRouteGroup{}).
		Select("user_subscription_id").Where("group_name = ?", groupName)
	var subscription UserSubscription
	result := DB.Where("user_id = ? AND status = ? AND end_time > ? AND id IN (?)",
		userId, "active", common.GetTimestamp(), ids).
		Order("end_time desc, id desc").Limit(1).Find(&subscription)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	if subscription.MaxOutputTokens <= 0 {
		subscription.MaxOutputTokens = DefaultSubscriptionMaxOutputTokens
	}
	return &subscription, nil
}

func UserSubscriptionHasRouteGroupTx(tx *gorm.DB, subscriptionId int, groupName string) (bool, error) {
	if subscriptionId <= 0 {
		return false, errors.New("invalid user subscription id")
	}
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return false, nil
	}
	if tx == nil {
		tx = DB
	}
	var count int64
	if err := tx.Model(&UserSubscriptionRouteGroup{}).
		Where("user_subscription_id = ? AND group_name = ?", subscriptionId, groupName).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}
