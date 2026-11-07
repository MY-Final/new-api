package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetDailyEgg(c *gin.Context) {
	status, err := model.GetDailyEggStatus(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, status)
}

func OpenDailyEgg(c *gin.Context) {
	var request struct {
		Egg int `json:"egg" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid egg choice")
		return
	}
	draw, err := model.OpenDailyEgg(c.GetInt("id"), request.Egg)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, draw)
}
