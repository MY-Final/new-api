package model

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type cacheQuotaResult int

// QuotaAllocation records which wallet buckets were changed by one operation.
// Bonus quota is always consumed before paid quota.
type QuotaAllocation struct {
	Bonus int
	Paid  int
}

func (a QuotaAllocation) Total() int { return a.Bonus + a.Paid }

const (
	cacheQuotaInsufficient cacheQuotaResult = iota
	cacheQuotaOK
	cacheQuotaMiss
)

const userQuotaReserveScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or tonumber(redis.call('HGET', KEYS[1], 'CacheSchema') or '0') ~= tonumber(ARGV[3])
  or redis.call('HEXISTS', KEYS[1], 'Quota') == 0
  or redis.call('HEXISTS', KEYS[1], 'BonusQuota') == 0
  or redis.call('HEXISTS', KEYS[1], 'PaidQuota') == 0 then
  return {-1, 0, 0}
end
local quota = tonumber(redis.call('HGET', KEYS[1], 'Quota'))
if quota == nil or (ARGV[4] == '0' and quota < tonumber(ARGV[1])) then
  return {0, 0, 0}
end
local bonus = tonumber(redis.call('HGET', KEYS[1], 'BonusQuota')) or 0
local amount = tonumber(ARGV[1])
local bonusUsed = math.min(math.max(bonus, 0), amount)
local paidUsed = amount - bonusUsed
redis.call('HINCRBY', KEYS[1], 'Quota', -amount)
redis.call('HINCRBY', KEYS[1], 'BonusQuota', -bonusUsed)
redis.call('HINCRBY', KEYS[1], 'PaidQuota', -paidUsed)
return {1, bonusUsed, paidUsed}`

const userQuotaDeltaScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or tonumber(redis.call('HGET', KEYS[1], 'CacheSchema') or '0') ~= tonumber(ARGV[3])
  or redis.call('HEXISTS', KEYS[1], 'Quota') == 0 then
  return -1
end
redis.call('HINCRBY', KEYS[1], 'Quota', ARGV[1])
return 1`

const userQuotaSourceDeltaScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[4])
  or tonumber(redis.call('HGET', KEYS[1], 'CacheSchema') or '0') ~= tonumber(ARGV[5])
  or redis.call('HEXISTS', KEYS[1], 'Quota') == 0
  or redis.call('HEXISTS', KEYS[1], 'BonusQuota') == 0
  or redis.call('HEXISTS', KEYS[1], 'PaidQuota') == 0 then
  return -1
end
redis.call('HINCRBY', KEYS[1], 'Quota', ARGV[1])
redis.call('HINCRBY', KEYS[1], 'BonusQuota', ARGV[2])
redis.call('HINCRBY', KEYS[1], 'PaidQuota', ARGV[3])
return 1`

const tokenQuotaReserveScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or redis.call('HEXISTS', KEYS[1], 'RemainQuota') == 0
  or redis.call('HEXISTS', KEYS[1], 'UsedQuota') == 0 then
  return -1
end
local remain = tonumber(redis.call('HGET', KEYS[1], 'RemainQuota'))
if remain == nil or remain < tonumber(ARGV[1]) then
  return 0
end
redis.call('HINCRBY', KEYS[1], 'RemainQuota', -tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[1], 'UsedQuota', tonumber(ARGV[1]))
redis.call('HSET', KEYS[1], 'AccessedTime', ARGV[3])
return 1`

const tokenQuotaDeltaScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or redis.call('HEXISTS', KEYS[1], 'RemainQuota') == 0
  or redis.call('HEXISTS', KEYS[1], 'UsedQuota') == 0 then
  return -1
end
redis.call('HINCRBY', KEYS[1], 'RemainQuota', tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[1], 'UsedQuota', -tonumber(ARGV[1]))
redis.call('HSET', KEYS[1], 'AccessedTime', ARGV[3])
return 1`

func quotaResultFromLua(result int, err error) (cacheQuotaResult, error) {
	if err != nil {
		return cacheQuotaMiss, err
	}
	switch result {
	case 1:
		return cacheQuotaOK, nil
	case 0:
		return cacheQuotaInsufficient, nil
	default:
		return cacheQuotaMiss, nil
	}
}

func cacheTryReserveUserQuota(userID int, amount int64, allowDebt bool) (cacheQuotaResult, QuotaAllocation, error) {
	result, err := common.RDB.Eval(context.Background(), userQuotaReserveScript,
		[]string{getUserCacheKey(userID)}, amount, userID, userCacheSchemaVersion, map[bool]string{true: "1", false: "0"}[allowDebt]).Result()
	if err != nil {
		return cacheQuotaMiss, QuotaAllocation{}, err
	}
	values, ok := result.([]interface{})
	if !ok || len(values) != 3 {
		return cacheQuotaMiss, QuotaAllocation{}, fmt.Errorf("invalid quota reserve result: %v", result)
	}
	status, ok1 := redisInt(values[0])
	bonus, ok2 := redisInt(values[1])
	paid, ok3 := redisInt(values[2])
	if !ok1 || !ok2 || !ok3 {
		return cacheQuotaMiss, QuotaAllocation{}, fmt.Errorf("invalid quota reserve values: %v", result)
	}
	quotaResult, resultErr := quotaResultFromLua(int(status), nil)
	return quotaResult, QuotaAllocation{Bonus: int(bonus), Paid: int(paid)}, resultErr
}

func redisInt(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case string:
		var parsed int64
		_, err := fmt.Sscan(v, &parsed)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func cacheApplyUserQuotaSourceDelta(userID int, allocation QuotaAllocation) (cacheQuotaResult, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return cacheQuotaOK, nil
	}
	result, err := common.RDB.Eval(context.Background(), userQuotaSourceDeltaScript,
		[]string{getUserCacheKey(userID)}, allocation.Total(), allocation.Bonus, allocation.Paid, userID, userCacheSchemaVersion).Int()
	return quotaResultFromLua(result, err)
}

func cacheApplyUserQuotaDelta(userID int, delta int64) (cacheQuotaResult, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return cacheQuotaOK, nil
	}
	result, err := common.RDB.Eval(context.Background(), userQuotaDeltaScript,
		[]string{getUserCacheKey(userID)}, delta, userID, userCacheSchemaVersion).Int()
	return quotaResultFromLua(result, err)
}

func cacheTryReserveTokenQuota(id int, key string, amount int64) (cacheQuotaResult, error) {
	result, err := common.RDB.Eval(context.Background(), tokenQuotaReserveScript,
		[]string{getTokenCacheKey(key)}, amount, id, common.GetTimestamp()).Int()
	return quotaResultFromLua(result, err)
}

func cacheApplyTokenQuotaDelta(id int, key string, delta int64) (cacheQuotaResult, error) {
	result, err := common.RDB.Eval(context.Background(), tokenQuotaDeltaScript,
		[]string{getTokenCacheKey(key)}, delta, id, common.GetTimestamp()).Int()
	return quotaResultFromLua(result, err)
}

// persistUserQuotaDelta 把已在缓存侧预扣成功的增量落库；批量模式下入队，
// 直写模式下要求行存在（用户已删除时报错，交由调用方补偿缓存）。
func persistUserQuotaAllocationDelta(id int, allocation QuotaAllocation, forceDB bool) error {
	if common.BatchUpdateEnabled && !forceDB {
		addUserQuotaSourceRecord(id, allocation)
		return nil
	}
	result := DB.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
		"quota":       gorm.Expr("quota + ?", allocation.Total()),
		"bonus_quota": gorm.Expr("bonus_quota + ?", allocation.Bonus),
		"paid_quota":  gorm.Expr("paid_quota + ?", allocation.Paid),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func persistTokenQuotaDelta(id int, delta int) error {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeTokenQuota, id, delta)
		return nil
	}
	result := DB.Model(&Token{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota + ?", delta),
			"used_quota":    gorm.Expr("used_quota - ?", delta),
			"accessed_time": common.GetTimestamp(),
		},
	)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func normalizeUserQuotaSources(id int) error {
	return DB.Model(&User{}).
		Where("id = ? AND bonus_quota = 0 AND paid_quota = 0 AND quota <> 0", id).
		Update("paid_quota", gorm.Expr("quota")).Error
}

func reserveUserQuotaDB(id int, quota int, allowDebt bool) (bool, QuotaAllocation, error) {
	if err := normalizeUserQuotaSources(id); err != nil {
		return false, QuotaAllocation{}, err
	}
	tx := DB.Begin()
	if tx.Error != nil {
		return false, QuotaAllocation{}, tx.Error
	}
	defer tx.Rollback()
	var user User
	if err := lockForUpdate(tx).Where("id = ?", id).First(&user).Error; err != nil {
		return false, QuotaAllocation{}, err
	}
	if !allowDebt && user.Quota < quota {
		return false, QuotaAllocation{}, nil
	}
	bonus := user.BonusQuota
	if bonus < 0 {
		bonus = 0
	}
	if bonus > quota {
		bonus = quota
	}
	allocation := QuotaAllocation{Bonus: bonus, Paid: quota - bonus}
	if err := tx.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
		"quota":       gorm.Expr("quota - ?", quota),
		"bonus_quota": gorm.Expr("bonus_quota - ?", allocation.Bonus),
		"paid_quota":  gorm.Expr("paid_quota - ?", allocation.Paid),
	}).Error; err != nil {
		return false, QuotaAllocation{}, err
	}
	if err := tx.Commit().Error; err != nil {
		return false, QuotaAllocation{}, err
	}
	return true, allocation, nil
}

func reserveTokenQuotaDB(id int, quota int) (bool, error) {
	result := DB.Model(&Token{}).
		Where("id = ? AND remain_quota >= ?", id, quota).
		Updates(map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota - ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"accessed_time": common.GetTimestamp(),
		})
	return result.RowsAffected == 1, result.Error
}

// TryReserveUserQuota atomically checks and deducts a user's wallet quota.
// 缓存命中时以缓存余额为准（避免批量模式下过期的数据库余额放大并发超扣）；
// Redis 异常或水合失败时降级为数据库条件更新，保证服务可用。
func TryReserveUserQuota(id int, quota int) (bool, error) {
	reserved, _, err := TryReserveUserQuotaAllocation(id, quota)
	return reserved, err
}

func TryReserveUserQuotaAllocation(id int, quota int) (bool, QuotaAllocation, error) {
	if quota < 0 {
		return false, QuotaAllocation{}, errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return true, QuotaAllocation{}, nil
	}
	if !common.RedisEnabled {
		return reserveUserQuotaDB(id, quota, false)
	}

	result, allocation, err := cacheTryReserveUserQuota(id, int64(quota), false)
	if err == nil && result == cacheQuotaMiss {
		if _, hydrateErr := GetUserCache(id); hydrateErr == nil {
			result, allocation, err = cacheTryReserveUserQuota(id, int64(quota), false)
		}
	}
	if err != nil || result == cacheQuotaMiss {
		if err != nil {
			common.SysLog("user quota cache reserve unavailable, falling back to database: " + err.Error())
		}
		return reserveUserQuotaDB(id, quota, false)
	}
	if result == cacheQuotaInsufficient {
		return false, QuotaAllocation{}, nil
	}
	if err = persistUserQuotaAllocationDelta(id, QuotaAllocation{Bonus: -allocation.Bonus, Paid: -allocation.Paid}, false); err != nil {
		compensated, compensateErr := cacheApplyUserQuotaSourceDelta(id, QuotaAllocation{Bonus: allocation.Bonus, Paid: allocation.Paid})
		if compensateErr != nil || compensated != cacheQuotaOK {
			common.SysError(fmt.Sprintf("failed to compensate reserved user quota: result=%d error=%v", compensated, compensateErr))
		}
		return false, QuotaAllocation{}, err
	}
	return true, allocation, nil
}

// ConsumeUserQuota deducts from bonus first and puts any shortfall on paid
// quota. allowDebt is used by settlement, where the historical behavior is to
// let the paid bucket go negative rather than making bonus negative.
func ConsumeUserQuota(id int, quota int, allowDebt bool) (QuotaAllocation, error) {
	if quota < 0 {
		return QuotaAllocation{}, errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return QuotaAllocation{}, nil
	}
	if !common.RedisEnabled {
		reserved, allocation, err := reserveUserQuotaDB(id, quota, allowDebt)
		if err != nil {
			return QuotaAllocation{}, err
		}
		if !reserved {
			return QuotaAllocation{}, errors.New("quota insufficient")
		}
		return allocation, nil
	}
	result, allocation, err := cacheTryReserveUserQuota(id, int64(quota), allowDebt)
	if err == nil && result == cacheQuotaMiss {
		if _, hydrateErr := GetUserCache(id); hydrateErr == nil {
			result, allocation, err = cacheTryReserveUserQuota(id, int64(quota), allowDebt)
		}
	}
	if err != nil || result == cacheQuotaMiss {
		return func() (QuotaAllocation, error) {
			reserved, allocation, dbErr := reserveUserQuotaDB(id, quota, allowDebt)
			if dbErr != nil {
				return QuotaAllocation{}, dbErr
			}
			if !reserved {
				return QuotaAllocation{}, errors.New("quota insufficient")
			}
			return allocation, nil
		}()
	}
	if result == cacheQuotaInsufficient {
		return QuotaAllocation{}, errors.New("quota insufficient")
	}
	if err := persistUserQuotaAllocationDelta(id, QuotaAllocation{Bonus: -allocation.Bonus, Paid: -allocation.Paid}, false); err != nil {
		_, compensateErr := cacheApplyUserQuotaSourceDelta(id, allocation)
		if compensateErr != nil {
			common.SysError(fmt.Sprintf("failed to compensate consumed user quota: %v", compensateErr))
		}
		return QuotaAllocation{}, err
	}
	return allocation, nil
}

func AdjustUserQuotaAllocation(id int, allocation QuotaAllocation, db bool) error {
	if allocation.Total() == 0 {
		return nil
	}
	if !db && common.BatchUpdateEnabled {
		addUserQuotaSourceRecord(id, allocation)
		if common.RedisEnabled {
			if _, err := cacheApplyUserQuotaSourceDelta(id, allocation); err != nil {
				common.SysLog("failed to sync user quota source cache: " + err.Error())
			}
		}
		return nil
	}
	if err := persistUserQuotaAllocationDelta(id, allocation, db); err != nil {
		return err
	}
	if common.RedisEnabled {
		if _, err := cacheApplyUserQuotaSourceDelta(id, allocation); err != nil {
			common.SysLog("failed to sync user quota source cache: " + err.Error())
		}
	}
	return nil
}

type QuotaSource string

const (
	QuotaSourceBonus QuotaSource = "bonus"
	QuotaSourcePaid  QuotaSource = "paid"
)

func CreditUserQuota(id int, quota int, source QuotaSource, db bool) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if err := common.ValidateWalletQuota(quota); err != nil {
		return err
	}
	if quota == 0 {
		return nil
	}
	allocation := QuotaAllocation{Bonus: quota}
	if source == QuotaSourcePaid {
		allocation = QuotaAllocation{Paid: quota}
	} else if source != QuotaSourceBonus {
		return errors.New("invalid quota source")
	}
	return CreditUserQuotaAllocation(id, allocation, db)
}

func CreditUserQuotaAllocation(id int, allocation QuotaAllocation, db bool) error {
	if allocation.Bonus < 0 || allocation.Paid < 0 {
		return errors.New("quota allocation must not be negative")
	}
	total64 := int64(allocation.Bonus) + int64(allocation.Paid)
	if total64 > int64(common.MaxWalletQuota) {
		return ErrWalletQuotaLimitExceeded
	}
	total := int(total64)
	if total == 0 {
		return nil
	}
	if !db && common.BatchUpdateEnabled {
		addUserQuotaSourceRecord(id, allocation)
		go func() {
			if _, err := cacheApplyUserQuotaSourceDelta(id, allocation); err != nil {
				common.SysLog("failed to increase user quota source cache: " + err.Error())
			}
		}()
		return nil
	}
	if err := normalizeUserQuotaSources(id); err != nil {
		return err
	}
	result := DB.Model(&User{}).Where("id = ? AND quota <= ?", id, common.MaxWalletQuota-total).Updates(map[string]interface{}{
		"quota":       gorm.Expr("quota + ?", total),
		"bonus_quota": gorm.Expr("bonus_quota + ?", allocation.Bonus),
		"paid_quota":  gorm.Expr("paid_quota + ?", allocation.Paid),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		var count int64
		if err := DB.Model(&User{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return gorm.ErrRecordNotFound
		}
		return ErrWalletQuotaLimitExceeded
	}
	if common.RedisEnabled {
		go func() {
			if _, err := cacheApplyUserQuotaSourceDelta(id, allocation); err != nil {
				common.SysLog("failed to sync user quota source cache: " + err.Error())
			}
		}()
	}
	return nil
}

// TryReserveTokenQuota atomically checks and deducts a token quota. Unlimited
// tokens skip the balance check but still update remain/used accounting.
func TryReserveTokenQuota(id int, key string, quota int, unlimited bool) (bool, error) {
	if quota < 0 {
		return false, errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return true, nil
	}
	if unlimited {
		return true, DecreaseTokenQuota(id, key, quota)
	}
	if !common.RedisEnabled {
		return reserveTokenQuotaDB(id, quota)
	}

	result, err := cacheTryReserveTokenQuota(id, key, int64(quota))
	if err == nil && result == cacheQuotaMiss {
		if _, hydrateErr := GetTokenByKey(key, true); hydrateErr == nil {
			result, err = cacheTryReserveTokenQuota(id, key, int64(quota))
		}
	}
	if err != nil || result == cacheQuotaMiss {
		if err != nil {
			common.SysLog("token quota cache reserve unavailable, falling back to database: " + err.Error())
		}
		return reserveTokenQuotaDB(id, quota)
	}
	if result == cacheQuotaInsufficient {
		return false, nil
	}
	if err = persistTokenQuotaDelta(id, -quota); err != nil {
		compensated, compensateErr := cacheApplyTokenQuotaDelta(id, key, int64(quota))
		if compensateErr != nil || compensated != cacheQuotaOK {
			common.SysError(fmt.Sprintf("failed to compensate reserved token quota: result=%d error=%v", compensated, compensateErr))
		}
		return false, err
	}
	return true, nil
}
