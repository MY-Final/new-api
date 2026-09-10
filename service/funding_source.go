package service

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/model"
)

// ---------------------------------------------------------------------------
// FundingSource — 资金来源接口（钱包 or 订阅）
// ---------------------------------------------------------------------------

// FundingSource 抽象了预扣费的资金来源。
type FundingSource interface {
	// Source 返回资金来源标识："wallet" 或 "subscription"
	Source() string
	// PreConsume 从该资金来源预扣 amount 额度
	PreConsume(amount int) error
	// Settle 根据差额调整资金来源（正数补扣，负数退还）
	Settle(delta int) error
	// Refund 退还所有预扣费
	Refund() error
}

// ---------------------------------------------------------------------------
// WalletFunding — 钱包资金来源实现
// ---------------------------------------------------------------------------

// ErrInsufficientWalletQuota 钱包原子预扣失败（余额不足），未发生任何扣减。
// BillingSession 据此映射为 ErrorCodeInsufficientUserQuota，
// 使 wallet_first 等计费偏好可以回退到订阅。
var ErrInsufficientWalletQuota = errors.New("wallet quota insufficient")

type WalletFunding struct {
	userId          int
	consumed        int // legacy test/compatibility field; reserved tracks source amounts
	reserved        model.QuotaAllocation
	lastReservation model.QuotaAllocation
}

func (w *WalletFunding) Source() string { return BillingSourceWallet }

func (w *WalletFunding) PreConsume(amount int) error {
	if amount <= 0 {
		return nil
	}
	reserved, allocation, err := model.TryReserveUserQuotaAllocation(w.userId, amount)
	if err != nil {
		return err
	}
	if !reserved {
		return ErrInsufficientWalletQuota
	}
	w.reserved.Bonus += allocation.Bonus
	w.reserved.Paid += allocation.Paid
	w.lastReservation = allocation
	return nil
}

func (w *WalletFunding) ReserveAdditional(amount int) error {
	if amount <= 0 {
		return nil
	}
	allocation, err := model.ConsumeUserQuota(w.userId, amount, true)
	if err != nil {
		return err
	}
	w.reserved.Bonus += allocation.Bonus
	w.reserved.Paid += allocation.Paid
	w.lastReservation = allocation
	return nil
}

func (w *WalletFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		_, err := model.ConsumeUserQuota(w.userId, delta, true)
		return err
	}
	refund := -delta
	if refund > w.reserved.Total() {
		refund = w.reserved.Total()
	}
	paidRefund := refund
	if paidRefund > w.reserved.Paid {
		paidRefund = w.reserved.Paid
	}
	bonusRefund := refund - paidRefund
	allocation := model.QuotaAllocation{Bonus: bonusRefund, Paid: paidRefund}
	if err := model.AdjustUserQuotaAllocation(w.userId, allocation, false); err != nil {
		return err
	}
	w.reserved.Bonus -= bonusRefund
	w.reserved.Paid -= paidRefund
	return nil
}

func (w *WalletFunding) Refund() error {
	if w.reserved.Total() <= 0 {
		return nil
	}
	allocation := w.reserved
	if err := model.AdjustUserQuotaAllocation(w.userId, allocation, false); err != nil {
		return err
	}
	w.reserved = model.QuotaAllocation{}
	return nil
}

func (w *WalletFunding) RollbackLastReservation() error {
	allocation := w.lastReservation
	if allocation.Total() == 0 {
		return nil
	}
	if err := model.AdjustUserQuotaAllocation(w.userId, allocation, false); err != nil {
		return err
	}
	w.reserved.Bonus -= allocation.Bonus
	w.reserved.Paid -= allocation.Paid
	w.lastReservation = model.QuotaAllocation{}
	return nil
}

// ---------------------------------------------------------------------------
// SubscriptionFunding — 订阅资金来源实现
// ---------------------------------------------------------------------------

type SubscriptionFunding struct {
	requestId      string
	userId         int
	modelName      string
	amount         int64 // 预扣的订阅额度（subConsume）
	subscriptionId int
	preConsumed    int64
	// 以下字段在 PreConsume 成功后填充，供 RelayInfo 同步使用
	AmountTotal     int64
	AmountUsedAfter int64
	PlanId          int
	PlanTitle       string
}

func (s *SubscriptionFunding) Source() string { return BillingSourceSubscription }

func (s *SubscriptionFunding) PreConsume(_ int) error {
	// amount 参数被忽略，使用内部 s.amount（已在构造时根据 preConsumedQuota 计算）
	res, err := model.PreConsumeUserSubscription(s.requestId, s.userId, s.modelName, 0, s.amount)
	if err != nil {
		return err
	}
	s.subscriptionId = res.UserSubscriptionId
	s.preConsumed = res.PreConsumed
	s.AmountTotal = res.AmountTotal
	s.AmountUsedAfter = res.AmountUsedAfter
	// 获取订阅计划信息
	if planInfo, err := model.GetSubscriptionPlanInfoByUserSubscriptionId(res.UserSubscriptionId); err == nil && planInfo != nil {
		s.PlanId = planInfo.PlanId
		s.PlanTitle = planInfo.PlanTitle
	}
	return nil
}

func (s *SubscriptionFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	return model.PostConsumeUserSubscriptionDelta(s.subscriptionId, int64(delta))
}

func (s *SubscriptionFunding) Refund() error {
	if s.preConsumed <= 0 {
		return nil
	}
	return refundWithRetry(func() error {
		return model.RefundSubscriptionPreConsume(s.requestId)
	})
}

// refundWithRetry 尝试多次执行退款操作以提高成功率，只能用于基于事务的退款函数！！！！！！
// try to refund with retries, only for refund functions based on transactions!!!
func refundWithRetry(fn func() error) error {
	if fn == nil {
		return nil
	}
	const maxAttempts = 3
	var lastErr error
	for i := range maxAttempts {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if i < maxAttempts-1 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return lastErr
}
