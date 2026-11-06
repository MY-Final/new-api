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
import type { Row } from '@tanstack/react-table'
import { Edit, Link2, Power, PowerOff, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import { inviteCodeUrl } from '../lib/invite-code-form'
import type { InviteCode } from '../types'

export type InviteCodeActions = {
  onEdit: (code: InviteCode) => void
  onClaims: (code: InviteCode) => void
  onToggle: (code: InviteCode) => void
  togglingId?: number
}

export function InviteCodeRowActions(props: {
  row: Row<InviteCode>
  actions: InviteCodeActions
}) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const code = props.row.original
  return (
    <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
      <DropdownMenuItem onClick={() => props.actions.onEdit(code)}>
        {t('Edit')}
        <DropdownMenuShortcut>
          <Edit size={16} />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => props.actions.onClaims(code)}>
        {t('View registrations')}
        <DropdownMenuShortcut>
          <Users size={16} />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => copyToClipboard(inviteCodeUrl(code.code))}
      >
        {t('Copy invitation link')}
        <DropdownMenuShortcut>
          <Link2 size={16} />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={props.actions.togglingId === code.id}
        onClick={() => props.actions.onToggle(code)}
      >
        {code.enabled ? t('Disable') : t('Enable')}
        <DropdownMenuShortcut>
          {code.enabled ? <PowerOff size={16} /> : <Power size={16} />}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    </DataTableRowActionMenu>
  )
}
