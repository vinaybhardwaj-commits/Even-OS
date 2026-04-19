'use client';

/**
 * AdminShellClient — client wrapper that owns:
 *  - sidebar collapse state (persisted in localStorage)
 *  - ⌘K command palette visibility
 *  - top bar
 *  - main content scroll container
 */
import { useEffect, useState, useCallback } from 'react';
import type { AdminRoute } from '@/lib/admin-manifest';
import { AdminTopBar } from './AdminTopBar';
import { AdminSidebar } from './AdminSidebar';
import { CommandPalette } from './CommandPalette';

interface AdminUserSummary {
  name: string;
  email: string;
  role: string;
  department?: string;
}

interface AdminShellClientProps {
  user: AdminUserSummary;
  routes: AdminRoute[];
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'even-os-admin-sidebar-collapsed';

export function AdminShellClient({ user, routes, children }: AdminShellClientProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Hydrate sidebar collapse state
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ⌘K / Ctrl+K opens palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <AdminTopBar
        user={user}
        onSearchClick={() => setPaletteOpen(true)}
        onToggleSidebar={toggleSidebar}
      />
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar routes={routes} collapsed={collapsed} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        routes={routes}
      />
    </div>
  );
}
