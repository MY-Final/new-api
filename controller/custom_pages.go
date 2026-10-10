package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetCustomPages returns the administrator-configured embedded pages the
// current user may open. The list is filtered by role, so the URL of a page an
// administrator restricted to admins never reaches another user.
func GetCustomPages(c *gin.Context) {
	pages, err := model.GetCustomPagesForRole(c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, pages)
}
