package model

import (
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	BillingRecordTypeTopup      = "topup"
	BillingRecordTypeRedemption = "redemption"
)

// BillingRecord is the user-visible union of direct top-ups and redeemed codes.
// The source-specific fields are populated according to RecordType.
type BillingRecord struct {
	Id              int     `json:"id"`
	RecordType      string  `json:"record_type"`
	UserId          int     `json:"user_id"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no"`
	PaymentMethod   string  `json:"payment_method"`
	PaymentProvider string  `json:"payment_provider"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	Status          string  `json:"status"`
	Source          string  `json:"source"`
	CreditedQuota   int     `json:"credited_quota"`
	RefundedAt      int64   `json:"refunded_at"`
	RefundReason    string  `json:"refund_reason"`

	RedemptionId         int    `json:"redemption_id,omitempty"`
	RedemptionName       string `json:"redemption_name,omitempty"`
	RedemptionKey        string `json:"redemption_key,omitempty"`
	RedemptionType       string `json:"redemption_type,omitempty"`
	RedemptionQuota      int    `json:"redemption_quota,omitempty"`
	RedemptionPaidQuota  int    `json:"redemption_paid_quota,omitempty"`
	RedemptionBonusQuota int    `json:"redemption_bonus_quota,omitempty"`
	RedeemedTime         int64  `json:"redeemed_time,omitempty"`
}

func (record *BillingRecord) sortTime() int64 {
	if record.RecordType == BillingRecordTypeRedemption && record.RedeemedTime != 0 {
		return record.RedeemedTime
	}
	return record.CreateTime
}

func listBillingRecords[T any](query *gorm.DB, pageInfo *common.PageInfo) ([]T, int64, error) {
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	limit := pageInfo.GetEndIdx()
	if limit == 0 {
		return []T{}, total, nil
	}
	var records []T
	if err := query.Limit(limit).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// GetUserBillingHistory combines direct top-ups and redeemed codes into one
// time-ordered page. The existing 30-day history window applies to both types.
func GetUserBillingHistory(userId int, keyword string, pageInfo *common.PageInfo) ([]*BillingRecord, int64, error) {
	if userId <= 0 {
		return []*BillingRecord{}, 0, nil
	}

	cutoff := topUpQueryCutoff()
	topUpQuery := DB.Model(&TopUp{}).
		Where("user_id = ? AND create_time >= ?", userId, cutoff).
		Order("create_time desc, id desc")
	redemptionQuery := DB.Model(&Redemption{}).
		Where("used_user_id = ? AND status IN ? AND redeemed_time >= ?", userId, []int{
			common.RedemptionCodeStatusUsed,
			common.RedemptionCodeStatusRefunded,
		}, cutoff).
		Order("redeemed_time desc, id desc")

	if keyword != "" {
		pattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		topUpQuery = topUpQuery.Where("trade_no LIKE ? ESCAPE '!'", pattern)

		redemptionId, idErr := strconv.Atoi(keyword)
		redemptionQuery = redemptionQuery.Where(
			"("+commonKeyCol+" LIKE ? ESCAPE '!' OR name LIKE ? OR id = ?)",
			pattern,
			pattern,
			func() int {
				if idErr == nil {
					return redemptionId
				}
				return -1
			}(),
		)
	}

	topUps, topUpTotal, err := listBillingRecords[*TopUp](topUpQuery, pageInfo)
	if err != nil {
		return nil, 0, err
	}
	redemptions, redemptionTotal, err := listBillingRecords[*Redemption](redemptionQuery, pageInfo)
	if err != nil {
		return nil, 0, err
	}

	records := make([]*BillingRecord, 0, len(topUps)+len(redemptions))
	for _, topUp := range topUps {
		records = append(records, &BillingRecord{
			Id:              topUp.Id,
			RecordType:      BillingRecordTypeTopup,
			UserId:          topUp.UserId,
			Amount:          topUp.Amount,
			Money:           topUp.Money,
			TradeNo:         topUp.TradeNo,
			PaymentMethod:   topUp.PaymentMethod,
			PaymentProvider: topUp.PaymentProvider,
			CreateTime:      topUp.CreateTime,
			CompleteTime:    topUp.CompleteTime,
			Status:          topUp.Status,
			Source:          topUp.Source,
			CreditedQuota:   topUp.CreditedQuota,
			RefundedAt:      topUp.RefundedAt,
			RefundReason:    topUp.RefundReason,
		})
	}
	for _, redemption := range redemptions {
		paidQuota, bonusQuota := redemption.PaidQuota, redemption.BonusQuota
		if allocation, allocationErr := redemption.quotaAllocation(); allocationErr == nil {
			paidQuota, bonusQuota = allocation.Paid, allocation.Bonus
		}
		records = append(records, &BillingRecord{
			Id:                   redemption.Id,
			RecordType:           BillingRecordTypeRedemption,
			UserId:               redemption.UsedUserId,
			CreateTime:           redemption.RedeemedTime,
			Status:               redemptionStatus(redemption.Status),
			RedemptionId:         redemption.Id,
			RedemptionName:       redemption.Name,
			RedemptionKey:        redemption.Key,
			RedemptionType:       redemption.Type,
			RedemptionQuota:      redemption.Quota,
			RedemptionPaidQuota:  paidQuota,
			RedemptionBonusQuota: bonusQuota,
			RedeemedTime:         redemption.RedeemedTime,
			RefundedAt:           redemption.RefundedAt,
			RefundReason:         redemption.RefundReason,
		})
	}

	sort.SliceStable(records, func(i, j int) bool {
		if records[i].sortTime() != records[j].sortTime() {
			return records[i].sortTime() > records[j].sortTime()
		}
		if records[i].RecordType != records[j].RecordType {
			return records[i].RecordType < records[j].RecordType
		}
		return records[i].Id > records[j].Id
	})

	start := pageInfo.GetStartIdx()
	if start >= len(records) {
		return []*BillingRecord{}, topUpTotal + redemptionTotal, nil
	}
	end := start + pageInfo.GetPageSize()
	if end > len(records) {
		end = len(records)
	}
	return records[start:end], topUpTotal + redemptionTotal, nil
}

func redemptionStatus(status int) string {
	if status == common.RedemptionCodeStatusRefunded {
		return common.TopUpStatusRefunded
	}
	return "used"
}
