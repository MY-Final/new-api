package authz

const (
	ResourceTicket = "ticket"
)

var (
	TicketRead   = Permission{Resource: ResourceTicket, Action: ActionRead}
	TicketReply  = Permission{Resource: ResourceTicket, Action: ActionWrite}
	TicketManage = Permission{Resource: ResourceTicket, Action: ActionOperate}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceTicket,
		LabelKey: "Ticket Management",
		Actions: []ActionDefinition{
			{Action: ActionRead, LabelKey: "Read tickets", DescriptionKey: "View and search customer tickets.", DefaultRoles: []string{BuiltInRoleAdmin}},
			{Action: ActionWrite, LabelKey: "Reply to tickets", DescriptionKey: "Reply to customers and add internal notes.", DefaultRoles: []string{BuiltInRoleAdmin}},
			{Action: ActionOperate, LabelKey: "Manage tickets", DescriptionKey: "Change ticket status and assignee.", DefaultRoles: []string{BuiltInRoleAdmin}},
		},
	})
}
