package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

const subscriptionRouteGroupDescription = "Subscription route group"

func GetUserUsableGroups(userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// 处理特殊可用分组
			for specialGroup, desc := range specialSettings {
				if after, ok := strings.CutPrefix(specialGroup, "-:"); ok {
					// 移除分组
					groupToRemove := after
					delete(groupsCopy, groupToRemove)
				} else if after, ok := strings.CutPrefix(specialGroup, "+:"); ok {
					// 添加分组
					groupToAdd := after
					groupsCopy[groupToAdd] = desc
				} else {
					// 直接添加分组
					groupsCopy[specialGroup] = desc
				}
			}
		}
		// 如果userGroup不在UserUsableGroups中，返回UserUsableGroups + userGroup。
		// 描述是英文源文本，由 web 控制台翻译；管理员配置的描述原样显示。
		if _, ok := groupsCopy[userGroup]; !ok {
			groupsCopy[userGroup] = "User group"
		}
	}
	return groupsCopy
}

// GetUserUsableGroupsForUser adds route groups snapshot on the user's active
// subscription. These groups can be selected even when they are not part of the
// normal UserUsableGroups configuration.
func GetUserUsableGroupsForUser(userGroup string, userId int) map[string]string {
	groups := GetUserUsableGroups(userGroup)
	if userId <= 0 {
		return groups
	}
	routeGroups, err := model.GetActiveSubscriptionRouteGroups(userId)
	if err != nil {
		common.SysError(common.LogText("failed to load active subscription route groups for user %d: %s", userId, err.Error()))
		return groups
	}
	for _, group := range routeGroups {
		if _, exists := groups[group]; !exists {
			groups[group] = subscriptionRouteGroupDescription
		}
	}
	return groups
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

func GroupInUserUsableGroupsForUser(userGroup string, userId int, groupName string) bool {
	_, ok := GetUserUsableGroupsForUser(userGroup, userId)[groupName]
	return ok
}

func IsUserSelectableGroup(userGroup, groupName string) bool {
	if groupName == "" || groupName == "auto" {
		return false
	}
	return GroupInUserUsableGroups(userGroup, groupName) && ratio_setting.ContainsGroupRatio(groupName)
}

func IsUserSelectableGroupForUser(userGroup string, userId int, groupName string) bool {
	if groupName == "" || groupName == "auto" {
		return false
	}
	return GroupInUserUsableGroupsForUser(userGroup, userId, groupName) &&
		ratio_setting.ContainsGroupRatio(groupName)
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	return getUserAutoGroup(userGroup, 0)
}

func GetUserAutoGroupForUser(userGroup string, userId int) []string {
	return getUserAutoGroup(userGroup, userId)
}

func getUserAutoGroup(userGroup string, userId int) []string {
	autoGroups := make([]string, 0)
	seen := make(map[string]struct{})
	usableGroups := GetUserUsableGroupsForUser(userGroup, userId)
	for _, group := range setting.GetAutoGroups() {
		_, usable := usableGroups[group]
		if group == "" || group == "auto" || !usable || !ratio_setting.ContainsGroupRatio(group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		autoGroups = append(autoGroups, group)
	}
	return autoGroups
}

// FilterUserTokenAutoGroups applies current permissions before the current
// per-token limit. It intentionally does not fall back to the global Auto list.
func FilterUserTokenAutoGroups(userGroup string, groups []string) []string {
	return filterUserTokenAutoGroups(userGroup, 0, groups)
}

func FilterUserTokenAutoGroupsForUser(userGroup string, userId int, groups []string) []string {
	return filterUserTokenAutoGroups(userGroup, userId, groups)
}

func filterUserTokenAutoGroups(userGroup string, userId int, groups []string) []string {
	maxCount := setting.GetMaxTokenAutoGroups()
	filtered := make([]string, 0, min(len(groups), maxCount))
	seen := make(map[string]struct{})
	usableGroups := GetUserUsableGroupsForUser(userGroup, userId)
	for _, group := range groups {
		_, usable := usableGroups[group]
		if group == "" || group == "auto" || !usable || !ratio_setting.ContainsGroupRatio(group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		filtered = append(filtered, group)
		if len(filtered) == maxCount {
			break
		}
	}
	return filtered
}

// GetRequestAutoGroups resolves the ordered Auto groups for the current token.
// The absence of the context value means that the token inherits the complete
// global Auto list; a present (even empty) value is an explicit token snapshot.
func GetRequestAutoGroups(c *gin.Context, userGroup string) []string {
	userId := c.GetInt("id")
	return GetRequestAutoGroupsForUser(c, userGroup, userId)
}

func GetRequestAutoGroupsForUser(c *gin.Context, userGroup string, userId int) []string {
	value, ok := common.GetContextKey(c, constant.ContextKeyTokenAutoGroups)
	if !ok {
		return GetUserAutoGroupForUser(userGroup, userId)
	}
	groups, ok := value.([]string)
	if !ok {
		return []string{}
	}
	return FilterUserTokenAutoGroupsForUser(userGroup, userId, groups)
}

// GetGroupsEnabledModels 按 groups 顺序获取各分组启用的模型并去重
func GetGroupsEnabledModels(groups []string) []string {
	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, group := range groups {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if _, ok := seen[modelName]; !ok {
				seen[modelName] = struct{}{}
				models = append(models, modelName)
			}
		}
	}
	return models
}

// GetUserGroupRatio 获取用户使用某个分组的倍率
// userGroup 用户分组
// group 需要获取倍率的分组
func GetUserGroupRatio(userGroup, group string) float64 {
	ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group)
	if ok {
		return ratio
	}
	return ratio_setting.GetGroupRatio(group)
}
