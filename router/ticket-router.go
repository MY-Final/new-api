package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
)

func registerTicketRoutes(api *gin.RouterGroup) {
	user := api.Group("/tickets", middleware.UserAuth(), middleware.DisableCache())
	user.GET("", controller.ListTickets)
	user.GET("/unread", controller.TicketUnread)
	user.POST("", middleware.UserCriticalRateLimit("ticket-create"), controller.CreateTicket)
	user.GET("/:id", controller.GetTicket)
	user.GET("/:id/attachments/:attachment", controller.GetTicketScreenshot)
	user.POST("/:id/messages", middleware.UserCriticalRateLimit("ticket-reply"), controller.ReplyTicket)
	user.POST("/:id/read", controller.ReadTicket)
	user.PATCH("/:id", middleware.UserCriticalRateLimit("ticket-update"), controller.ChangeTicket)

	staff := api.Group("/admin/tickets", middleware.UserAuth(), middleware.DisableCache(), middleware.RequirePermission(authz.TicketRead))
	staff.Use(func(c *gin.Context) { c.Set("ticket_staff", true); c.Next() })
	staff.GET("", controller.ListTickets)
	staff.GET("/unread", controller.TicketUnread)
	staff.GET("/storage", middleware.RootAuth(), controller.GetTicketStorageSettings)
	staff.PUT("/storage", middleware.RootAuth(), controller.UpdateTicketStorageSettings)
	staff.GET("/:id", controller.GetTicket)
	staff.GET("/:id/attachments/:attachment", controller.GetTicketScreenshot)
	staff.POST("/:id/read", controller.ReadTicket)
	staff.POST("/:id/messages", middleware.RequirePermission(authz.TicketReply), middleware.UserCriticalRateLimit("ticket-reply"), controller.ReplyTicket)
	staff.POST("/:id/notes", middleware.RequirePermission(authz.TicketReply), middleware.UserCriticalRateLimit("ticket-note"), func(c *gin.Context) { c.Set("ticket_note", true); controller.ReplyTicket(c) })
	staff.PATCH("/:id", middleware.RequirePermission(authz.TicketManage), controller.ChangeTicket)
	staff.POST("/cleanup", middleware.RootAuth(), controller.CleanupTickets)
}
