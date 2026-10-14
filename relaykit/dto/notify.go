package dto

type Notify struct {
	Type    string `json:"type"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Values  []any  `json:"values"`
	// Variables carry named values for channels that render templates instead of
	// the positional {{value}} placeholders used by webhook, Bark and Gotify.
	Variables map[string]string `json:"variables,omitempty"`
}

const ContentValueParam = "{{value}}"

const (
	NotifyTypeQuotaExceed   = "quota_exceed"
	NotifyTypeChannelUpdate = "channel_update"
	NotifyTypeChannelTest   = "channel_test"
)

func NewNotify(t string, title string, content string, values []any) Notify {
	return Notify{
		Type:    t,
		Title:   title,
		Content: content,
		Values:  values,
	}
}

func (n Notify) WithVariables(variables map[string]string) Notify {
	n.Variables = variables
	return n
}
