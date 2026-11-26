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
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { CustomPageHighlightColor } from '@/lib/custom-pages'
import { cn } from '@/lib/utils'

import { checkIsActive } from '../lib/url-utils'
import type {
  NavCollapsible,
  NavChatPresets,
  NavLink,
  NavGroup as NavGroupProps,
} from '../types'
import { ChatPresetsItem } from './chat-presets-item'

const highlightColors = {
  blue: 'bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 hover:text-blue-700 data-active:bg-blue-500/20 data-active:text-blue-700 dark:text-blue-300',
  green:
    'bg-green-500/10 text-green-700 hover:bg-green-500/15 hover:text-green-700 data-active:bg-green-500/20 data-active:text-green-700 dark:text-green-300',
  purple:
    'bg-purple-500/10 text-purple-700 hover:bg-purple-500/15 hover:text-purple-700 data-active:bg-purple-500/20 data-active:text-purple-700 dark:text-purple-300',
  orange:
    'bg-orange-500/10 text-orange-700 hover:bg-orange-500/15 hover:text-orange-700 data-active:bg-orange-500/20 data-active:text-orange-700 dark:text-orange-300',
  red: 'bg-red-500/10 text-red-700 hover:bg-red-500/15 hover:text-red-700 data-active:bg-red-500/20 data-active:text-red-700 dark:text-red-300',
  cyan: 'bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/15 hover:text-cyan-700 data-active:bg-cyan-500/20 data-active:text-cyan-700 dark:text-cyan-300 dark:hover:text-cyan-300 dark:data-active:text-cyan-300 dark:data-active:hover:text-cyan-300',
  teal: 'bg-teal-500/10 text-teal-700 hover:bg-teal-500/15 hover:text-teal-700 data-active:bg-teal-500/20 data-active:text-teal-700 dark:text-teal-300 dark:hover:text-teal-300 dark:data-active:text-teal-300 dark:data-active:hover:text-teal-300',
  emerald:
    'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-700 data-active:bg-emerald-500/20 data-active:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-300 dark:data-active:text-emerald-300 dark:data-active:hover:text-emerald-300',
  lime: 'bg-lime-500/10 text-lime-800 hover:bg-lime-500/15 hover:text-lime-800 data-active:bg-lime-500/20 data-active:text-lime-800 dark:text-lime-300 dark:hover:text-lime-300 dark:data-active:text-lime-300 dark:data-active:hover:text-lime-300',
  pink: 'bg-pink-500/10 text-pink-700 hover:bg-pink-500/15 hover:text-pink-700 data-active:bg-pink-500/20 data-active:text-pink-700 dark:text-pink-300 dark:hover:text-pink-300 dark:data-active:text-pink-300 dark:data-active:hover:text-pink-300',
  rose: 'bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 hover:text-rose-700 data-active:bg-rose-500/20 data-active:text-rose-700 dark:text-rose-300 dark:hover:text-rose-300 dark:data-active:text-rose-300 dark:data-active:hover:text-rose-300',
  indigo:
    'bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/15 hover:text-indigo-700 data-active:bg-indigo-500/20 data-active:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-300 dark:data-active:text-indigo-300 dark:data-active:hover:text-indigo-300',
  slate:
    'bg-slate-500/10 text-slate-700 hover:bg-slate-500/15 hover:text-slate-700 data-active:bg-slate-500/20 data-active:text-slate-700 dark:text-slate-300 dark:hover:text-slate-300 dark:data-active:text-slate-300 dark:data-active:hover:text-slate-300',
  sunset:
    'bg-linear-to-r from-orange-400/15 to-pink-500/15 text-rose-700 hover:from-orange-400/25 hover:to-pink-500/25 hover:text-rose-700 data-active:text-rose-700 dark:text-rose-300 dark:hover:text-rose-300 dark:data-active:text-rose-300',
  ocean:
    'bg-linear-to-r from-cyan-400/15 to-blue-500/15 text-blue-700 hover:from-cyan-400/25 hover:to-blue-500/25 hover:text-blue-700 data-active:text-blue-700 dark:text-blue-300 dark:hover:text-blue-300 dark:data-active:text-blue-300',
  aurora:
    'bg-linear-to-r from-emerald-400/15 via-cyan-400/15 to-violet-500/15 text-teal-700 hover:from-emerald-400/25 hover:via-cyan-400/25 hover:to-violet-500/25 hover:text-teal-700 data-active:text-teal-700 dark:text-teal-300 dark:hover:text-teal-300 dark:data-active:text-teal-300',
  rainbow:
    'bg-linear-to-r from-rose-400/15 via-amber-300/15 to-sky-500/15 text-violet-800 hover:from-rose-400/25 hover:via-amber-300/25 hover:to-sky-500/25 hover:text-violet-800 data-active:text-violet-800 dark:text-violet-200 dark:hover:text-violet-200 dark:data-active:text-violet-200',
} satisfies Record<Exclude<CustomPageHighlightColor, ''>, string>

/**
 * Sidebar navigation group component
 * Renders a group of navigation items, supporting regular links and collapsible submenus
 */
export function NavGroup({
  id,
  title,
  items,
  isFirst = false,
}: NavGroupProps & { isFirst?: boolean }) {
  const { state, isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })

  return (
    <GroupSection
      id={id}
      isFirst={isFirst}
      title={title}
      items={items}
      href={href}
      state={state}
      isMobile={isMobile}
    />
  )
}

function GroupSection(props: {
  id?: string
  isFirst: boolean
  title: string
  items: NavGroupProps['items']
  href: string
  state: 'expanded' | 'collapsed'
  isMobile: boolean
}) {
  const normalizedHref = props.href.split('?')[0]
  const groupIsActive = props.items.some((item) => {
    if (item.type === 'chat-presets') {
      return normalizedHref.startsWith('/chat')
    }
    return checkIsActive(props.href, item)
  })
  const iconCollapsed = props.state === 'collapsed' && !props.isMobile

  return (
    <SidebarGroup
      className={cn(
        'px-2 py-0.5',
        iconCollapsed &&
          !props.isFirst &&
          'border-sidebar-border/70 mt-1.5 border-t pt-2'
      )}
    >
      <SidebarGroupLabel
        className={cn(
          'text-muted-foreground/70 px-2 text-[11px] font-medium tracking-wider uppercase',
          groupIsActive && 'text-sidebar-foreground'
        )}
      >
        {props.title}
      </SidebarGroupLabel>
      <SidebarMenu>
        {props.items.map((item) => {
          const key = `${item.title}-${item.url || item.type}`

          if (item.type === 'chat-presets') {
            return <ChatPresetsItem key={key} item={item as NavChatPresets} />
          }

          if (!item.items) {
            return (
              <SidebarMenuLink
                key={key}
                item={item as NavLink}
                href={props.href}
              />
            )
          }

          if (iconCollapsed) {
            return (
              <SidebarMenuCollapsedDropdown
                key={key}
                item={item as NavCollapsible}
                href={props.href}
              />
            )
          }

          return (
            <SidebarMenuCollapsible
              key={key}
              item={item as NavCollapsible}
              href={props.href}
            />
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

/**
 * Navigation badge component
 */
function NavBadge({ children }: { children: ReactNode }) {
  return <Badge className='shrink-0 px-1 py-0 text-xs'>{children}</Badge>
}

/**
 * Sidebar menu link item
 */
function SidebarMenuLink({ item, href }: { item: NavLink; href: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={checkIsActive(href, item)}
        tooltip={item.title}
        className={cn(
          item.highlight && 'font-medium',
          item.highlight &&
            (item.highlightColor
              ? highlightColors[item.highlightColor]
              : 'bg-amber-400/25 text-amber-700 hover:bg-amber-400/35 hover:text-amber-800 dark:bg-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-400/30 dark:hover:text-amber-200')
        )}
        render={
          <Link
            to={item.url}
            preload={isMobile ? false : undefined}
            onClick={() => setOpenMobile(false)}
          />
        }
      >
        {item.icon && <item.icon className='shrink-0' />}
        <span className='min-w-0 flex-1 truncate'>{item.title}</span>
        {item.badge && <NavBadge>{item.badge}</NavBadge>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Sidebar collapsible menu item
 */
function SidebarMenuCollapsible({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  // 检查当前路径是否匹配子菜单项
  const isSubItemActive = checkIsActive(href, item)
  // 使用受控状态，初始值基于当前路径是否匹配
  const [isOpen, setIsOpen] = useState(() => isSubItemActive)

  // 当路径变化时，如果匹配子菜单项，自动展开父级菜单
  useEffect(() => {
    if (isSubItemActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpen(true)
    }
  }, [isSubItemActive])

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className='group/collapsible'
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        className='group/collapsible-trigger'
        render={<SidebarMenuButton tooltip={item.title} />}
      >
        {item.icon && <item.icon className='shrink-0' />}
        <span className='min-w-0 flex-1 truncate'>{item.title}</span>
        {item.badge && <NavBadge>{item.badge}</NavBadge>}
        <ChevronRight className='ms-auto size-4 shrink-0 transition-transform duration-200 group-data-[panel-open]/collapsible-trigger:rotate-90' />
      </CollapsibleTrigger>
      <CollapsibleContent className='CollapsibleContent'>
        <SidebarMenuSub>
          {item.items.map((subItem) => (
            <SidebarMenuSubItem key={subItem.title}>
              <SidebarMenuSubButton
                isActive={checkIsActive(href, subItem)}
                render={
                  <Link
                    to={subItem.url}
                    preload={isMobile ? false : undefined}
                    onClick={() => setOpenMobile(false)}
                  />
                }
              >
                {subItem.icon && <subItem.icon className='shrink-0' />}
                <span className='min-w-0 flex-1 truncate'>{subItem.title}</span>
                {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Sidebar dropdown menu item when collapsed
 */
function SidebarMenuCollapsedDropdown({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          className='group/dropdown-trigger'
          render={
            <SidebarMenuButton
              tooltip={item.title}
              isActive={checkIsActive(href, item)}
            />
          }
        >
          {item.icon && <item.icon className='shrink-0' />}
          <span className='min-w-0 flex-1 truncate'>{item.title}</span>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
          <ChevronRight className='ms-auto size-4 shrink-0 transition-transform duration-200 group-data-[popup-open]/dropdown-trigger:rotate-90' />
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start' sideOffset={4}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {item.title} {item.badge ? `(${item.badge})` : ''}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {item.items.map((sub) => (
              <DropdownMenuItem
                key={`${sub.title}-${sub.url}`}
                render={
                  <Link
                    to={sub.url}
                    className={`${checkIsActive(href, sub) ? 'bg-secondary' : ''}`}
                  />
                }
              >
                {sub.icon && <sub.icon />}
                <span className='max-w-52 text-wrap'>{sub.title}</span>
                {sub.badge && (
                  <span className='ms-auto text-xs'>{sub.badge}</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
