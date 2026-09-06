package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

type Redemption struct {
	Id                     int            `json:"id"`
	UserId                 int            `json:"user_id"`
	Key                    string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status                 int            `json:"status" gorm:"default:1"`
	Name                   string         `json:"name" gorm:"index"`
	Quota                  int            `json:"quota" gorm:"default:100"`
	CreatedTime            int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime           int64          `json:"redeemed_time" gorm:"bigint"`
	Count                  int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId             int            `json:"used_user_id"`
	DeletedAt              gorm.DeletedAt `gorm:"index"`
	ExpiredTime            int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
	Type                   string         `json:"type" gorm:"type:varchar(16);index"`
	RefundedAt             int64          `json:"refunded_at" gorm:"bigint"`
	RefundReason           string         `json:"refund_reason" gorm:"type:varchar(255)"`
	RefundedBy             int            `json:"refunded_by" gorm:"index"`
	UsedUsername           string         `json:"used_username,omitempty" gorm:"->;-:migration"`
	UsedUserQuota          int            `json:"used_user_quota,omitempty" gorm:"->;-:migration"`
	RebateQuota            int            `json:"rebate_quota,omitempty" gorm:"->;-:migration"`
	RebateReversedQuota    int            `json:"rebate_reversed_quota,omitempty" gorm:"->;-:migration"`
	RebateTransferredQuota int            `json:"rebate_transferred_quota,omitempty" gorm:"->;-:migration"`
	InviterId              int            `json:"inviter_id,omitempty" gorm:"->;-:migration"`
	InviterUsername        string         `json:"inviter_username,omitempty" gorm:"->;-:migration"`
	InviterQuota           int            `json:"inviter_quota,omitempty" gorm:"->;-:migration"`
	InviterAffQuota        int            `json:"inviter_aff_quota,omitempty" gorm:"->;-:migration"`
}

const (
	RedemptionTypePaid   = "paid"
	RedemptionTypeReward = "reward"
	maxBatchRedemptions  = 100
)

var (
	ErrBatchRedemptionEmpty   = errors.New("at least one redemption code is required")
	ErrBatchRedemptionTooMany = errors.New("too many redemption codes in one batch")
	ErrBatchRedemptionNoop    = errors.New("at least one field must be updated")
)

func (redemption *Redemption) BeforeSave(tx *gorm.DB) error {
	if redemption.Type == "" {
		redemption.Type = RedemptionTypeReward
	}
	if redemption.Type != RedemptionTypePaid && redemption.Type != RedemptionTypeReward {
		return errors.New("invalid redemption type")
	}
	return nil
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(keyword string, status string, redemptionType string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})

	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
		} else {
			query = query.Where("name LIKE ?", keyword+"%")
		}
	}

	if status != "" {
		now := common.GetTimestamp()
		switch status {
		case "expired":
			query = query.Where(
				"status = ? AND expired_time != 0 AND expired_time < ?",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusEnabled):
			query = query.Where(
				"status = ? AND (expired_time = 0 OR expired_time >= ?)",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusDisabled):
			query = query.Where("status = ?", common.RedemptionCodeStatusDisabled)
		case strconv.Itoa(common.RedemptionCodeStatusUsed):
			query = query.Where("status = ?", common.RedemptionCodeStatusUsed)
		case strconv.Itoa(common.RedemptionCodeStatusRefunded):
			query = query.Where("status = ?", common.RedemptionCodeStatusRefunded)
		}
	}

	if redemptionType == RedemptionTypePaid || redemptionType == RedemptionTypeReward {
		query = query.Where("type = ?", redemptionType)
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

func Redeem(key string, userId int) (quota int, err error) {
	if key == "" {
		return 0, errors.New("未提供兑换码")
	}
	if userId == 0 {
		return 0, errors.New("无效的 user id")
	}
	redemption := &Redemption{}

	keyCol := "`key`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		keyCol = `"key"`
	}
	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(keyCol+" = ?", key).First(redemption).Error
		if err != nil {
			return errors.New("无效的兑换码")
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return errors.New("该兑换码已被使用")
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return errors.New("该兑换码已过期")
		}
		// Compare-and-swap on status: only the transaction that flips
		// enabled -> used may credit quota, so a concurrent redeem of the
		// same code loses here even without a row lock (e.g. on SQLite).
		result := tx.Model(&Redemption{}).
			Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
			Updates(map[string]interface{}{
				"redeemed_time": common.GetTimestamp(),
				"status":        common.RedemptionCodeStatusUsed,
				"used_user_id":  userId,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("该兑换码已被使用")
		}
		if err := creditTopUpQuota(tx, userId, redemption.Quota, nil); err != nil {
			return err
		}
		return recordAffiliateRebateForRedemptionTx(tx, redemption, userId)
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		return 0, ErrRedeemFailed
	}
	syncCreditUserQuotaCache(userId, redemption.Quota, "redemption")
	invalidateAffiliateRebateUserCache(AffiliateRebateSourceRedemption, fmt.Sprintf("%d", redemption.Id), "redemption rebate")
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("通过兑换码充值 %s，兑换码ID %d", logger.LogQuota(redemption.Quota), redemption.Id))
	return redemption.Quota, nil
}

func (redemption *Redemption) Insert() error {
	if redemption.Quota <= 0 {
		return errors.New("redemption quota must be positive")
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		return err
	}
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) SelectUpdate() error {
	// This can update zero values
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	if redemption.Quota <= 0 {
		return errors.New("redemption quota must be positive")
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		return err
	}
	var existing Redemption
	if err := DB.Select("status").Where("id = ?", redemption.Id).First(&existing).Error; err != nil {
		return err
	}
	if existing.Status == common.RedemptionCodeStatusUsed || existing.Status == common.RedemptionCodeStatusRefunded {
		return errors.New("used or refunded redemption codes cannot be modified")
	}
	result := DB.Model(redemption).
		Where("id = ? AND status IN ?", redemption.Id, []int{common.RedemptionCodeStatusEnabled, common.RedemptionCodeStatusDisabled}).
		Select("name", "status", "quota", "redeemed_time", "expired_time", "type").Updates(redemption)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("used or refunded redemption codes cannot be modified")
	}
	return nil
}

func normalizeRedemptionIDs(ids []int) ([]int, error) {
	unique := make([]int, 0, len(ids))
	seen := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, errors.New("redemption id must be positive")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return nil, ErrBatchRedemptionEmpty
	}
	if len(unique) > maxBatchRedemptions {
		return nil, ErrBatchRedemptionTooMany
	}
	return unique, nil
}

func BatchUpdateRedemptions(ids []int, name *string, redemptionType *string, quota *int, status *int) (int, error) {
	ids, err := normalizeRedemptionIDs(ids)
	if err != nil {
		return 0, err
	}
	if name == nil && redemptionType == nil && quota == nil && status == nil {
		return 0, ErrBatchRedemptionNoop
	}

	var normalizedName string
	if name != nil {
		normalizedName = strings.TrimSpace(*name)
		if utf8.RuneCountInString(normalizedName) == 0 || utf8.RuneCountInString(normalizedName) > 20 {
			return 0, errors.New("redemption name must contain 1 to 20 characters")
		}
	}
	if redemptionType != nil && *redemptionType != RedemptionTypePaid && *redemptionType != RedemptionTypeReward {
		return 0, errors.New("invalid redemption type")
	}
	if quota != nil {
		if *quota <= 0 {
			return 0, errors.New("redemption quota must be positive")
		}
		if err := common.ValidateWalletQuota(*quota); err != nil {
			return 0, err
		}
	}
	if status != nil && *status != common.RedemptionCodeStatusEnabled && *status != common.RedemptionCodeStatusDisabled {
		return 0, errors.New("invalid redemption status")
	}

	updated := 0
	err = DB.Transaction(func(tx *gorm.DB) error {
		for _, id := range ids {
			var redemption Redemption
			if err := lockForUpdate(tx).Where("id = ?", id).First(&redemption).Error; err != nil {
				return err
			}
			if redemption.Status == common.RedemptionCodeStatusUsed || redemption.Status == common.RedemptionCodeStatusRefunded {
				return fmt.Errorf("redemption %d is already used or refunded", id)
			}

			changes := make(map[string]interface{})
			if name != nil {
				changes["name"] = normalizedName
			}
			if redemptionType != nil {
				changes["type"] = *redemptionType
			}
			if quota != nil {
				changes["quota"] = *quota
			}
			if status != nil {
				changes["status"] = *status
			}
			if err := tx.Model(&redemption).Updates(changes).Error; err != nil {
				return err
			}
			updated++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return updated, nil
}

func BatchDeleteRedemptions(ids []int) (int, error) {
	ids, err := normalizeRedemptionIDs(ids)
	if err != nil {
		return 0, err
	}

	deleted := 0
	err = DB.Transaction(func(tx *gorm.DB) error {
		for _, id := range ids {
			var redemption Redemption
			if err := lockForUpdate(tx).Where("id = ?", id).First(&redemption).Error; err != nil {
				return err
			}
			if redemption.Status == common.RedemptionCodeStatusUsed || redemption.Status == common.RedemptionCodeStatusRefunded {
				return fmt.Errorf("redemption %d is already used or refunded", id)
			}
			if err := tx.Delete(&redemption).Error; err != nil {
				return err
			}
			deleted++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
