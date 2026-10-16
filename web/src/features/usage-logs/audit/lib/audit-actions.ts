/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// Shared by the searchable action filter and audit event summaries.
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'finance.request_refund': 'Request refund',
  'finance.topup_refund': 'Top-up refund',
  'finance.redemption_refund': 'Redemption refund',
  'finance.rebate_reverse': 'Reverse rebate',
  'finance.penalty': 'Apply penalty',
  'finance.penalty_reverse': 'Reverse penalty',
  'finance.refund_batch.create': 'Submit refund batch',
  'finance.refund_batch.retry': 'Retry refund batch',
  'finance.refund_batch.item': 'Refund batch item',
  'finance.refund_batch.complete': 'Refund batch completed',
  login: 'Login',
  'login.failed': 'Login failed',
  'login.challenge': 'Login verification started',
  'session.refresh': 'Refresh session',
  'session.logout': 'Sign out',
  'session.revoke': 'Revoke session',
  'session.revoke_others': 'Sign out other devices',
  'user.password_reset': 'Password reset',
  'user.password_reset_request': 'Password reset request',
  'user.security_operation': 'Account security operation',
  'auth.rejected': 'Authorization rejected',
  'channel.test_all': 'Test all channels',
  'channel.test': 'Test channel',
  'channel.balance_refresh_all': 'Refresh all channel balances',
  'channel.balance_refresh': 'Refresh channel balance',
  'log.export': 'Export logs',
  'audit.read': 'View audit logs',
  'redemption.read': 'View redemption codes',
  'model.pricing.update': 'Update model pricing',
  'user.create': 'Create User',
  'user.update': 'Edit User',
  'user.delete': 'Delete User',
  'option.update': 'System Settings',
  'channel.create': 'Add Channel',
  'channel.update': 'Edit Channel',
  'channel.delete': 'Delete Channel',
  'channel.key_view': 'View key',
  'access_token.generate': 'Created an access token',
  'access_token.revoke': 'Revoked an access token',
  'access_token.update': 'Changed access token permissions',
  'user.password_change': 'Account password change',
  'user.security_verify': 'Completed security verification',
  'user.2fa_enable': 'Enabled two-factor authentication',
  'user.2fa_disable_self': 'Disabled two-factor authentication',
  'token.create': 'Create API token',
  'token.update': 'Update API token',
  'token.delete': 'Delete API token',
  'subscription.plan_update': 'Subscription plan updated',
  'subscription.plan_create': 'Subscription plan created',
}
