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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'

import { deletePlan } from '../../api'
import { useSubscriptions } from '../subscriptions-provider'

export function DeletePlanDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh, complianceConfirmed } =
    useSubscriptions()
  const [deleting, setDeleting] = useState(false)
  const isOpen = open === 'delete-plan' && Boolean(currentRow?.plan.id)
  const plan = currentRow?.plan
  const planLabel = plan?.title || (plan?.id ? `#${plan.id}` : '-')

  const handleConfirm = async () => {
    if (!plan?.id) return
    setDeleting(true)
    try {
      const res = await deletePlan(plan.id)
      if (res.success) {
        toast.success(t('Subscription plan deleted successfully'))
        triggerRefresh()
        setOpen(null)
      } else {
        handleServerError(res)
      }
    } catch (error) {
      handleServerError(error, t('Operation failed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ConfirmDialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !deleting) setOpen(null)
      }}
      title={t('Delete subscription plan "{{name}}"?', { name: planLabel })}
      desc={t(
        'Only plans that have never had user subscriptions or orders can be deleted. Disable a plan that is already in use.'
      )}
      confirmText={deleting ? t('Deleting...') : t('Delete')}
      destructive
      disabled={!complianceConfirmed || !plan?.id}
      isLoading={deleting}
      handleConfirm={handleConfirm}
    />
  )
}
