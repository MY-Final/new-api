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
import { useEffect } from 'react'

let openModals = 0

/**
 * Locks the console's own scroll containers while a modal is open.
 *
 * The dialog library only locks `documentElement`/`body`, but this console
 * scrolls inside the layout (`[data-app-scroll-container]`). Without this lock
 * the page behind a modal keeps scrolling, and its scrollbar stays visible next
 * to the dialog's own — reading as "two scrollbars".
 *
 * Nested modals are reference counted, so closing the inner one keeps the lock.
 */
export function useModalScrollLock(open: boolean | undefined): void {
  useEffect(() => {
    if (!open) return

    openModals += 1
    document.documentElement.dataset.modalOpen = 'true'

    return () => {
      openModals = Math.max(0, openModals - 1)
      if (openModals === 0) {
        delete document.documentElement.dataset.modalOpen
      }
    }
  }, [open])
}
