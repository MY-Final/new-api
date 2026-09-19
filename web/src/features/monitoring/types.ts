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
export interface LogAnalysisParams {
  start_timestamp: number
  end_timestamp: number
  model_name?: string
  username?: string
  channel?: number
  group?: string
  top_limit?: number
  realtime_minutes?: number
}

export interface LogAnalysisSummary {
  consume_count: number
  error_count: number
  quota: number
  tokens: number
  success_rate: number
}

export interface LogAnalysisRealtime {
  minutes: number
  consume_count: number
  error_count: number
  quota: number
  tokens: number
  active_users: number
  success_rate: number
  rpm: number
  tpm: number
}

export interface LogAnalysisTrendPoint {
  ts: number
  consume: number
  error: number
}

export interface LogAnalysisErrorCode {
  error_code: string
  error_type: string
  status_code: number
  count: number
  sample?: string
}

export interface LogAnalysisErrorModel {
  model_name: string
  count: number
}

export interface LogAnalysisErrorChannel {
  channel_id: number
  count: number
}

export interface LogAnalysisErrorUser {
  user_id: number
  username: string
  count: number
}

export interface LogAnalysisErrorToken {
  token_id: number
  token_name: string
  count: number
}

export interface LogAnalysisChannelHealth {
  channel_id: number
  channel_name: string
  status: number
  status_reason: string
  status_time: number
  consume_count: number
  error_count: number
  quota: number
  success_rate: number
  avg_latency_seconds: number
  p50_seconds: number
  p95_seconds: number
  p99_seconds: number
  max_latency_seconds: number
  auto_disabled_count: number
}

export interface LogAnalysisData {
  summary: LogAnalysisSummary
  realtime: LogAnalysisRealtime
  bucket_seconds: number
  trend: LogAnalysisTrendPoint[]
  error_codes: LogAnalysisErrorCode[]
  error_models: LogAnalysisErrorModel[]
  error_channels: LogAnalysisErrorChannel[]
  channels: LogAnalysisChannelHealth[]
  top_error_users: LogAnalysisErrorUser[]
  top_error_tokens: LogAnalysisErrorToken[]
  error_logs_truncated: boolean
}
