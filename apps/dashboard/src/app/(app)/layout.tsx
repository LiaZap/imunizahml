import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth';
import { LogoutButton } from './logout-button';
import { NotificationsListener } from './notifications-listener';
import { MobileNav } from './mobile-nav';
import { filterNavForRole } from './nav-items';
import { InstanceStatusBanner } from './instance-status-banner';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const visibleNav = filterNavForRole(user.role);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 lg:flex-row">
      <NotificationsListener />

      {/* Mobile nav (drawer + top bar) */}
      <MobileNav
        userName={user.name}
        userEmail={user.email}
        userRole={user.role}
        logoutSlot={<LogoutButton />}
      />

      {/* Desktop sidebar — fixa em altura de viewport, com seu proprio scroll interno */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="relative overflow-hidden bg-brand-gradient px-4 py-3">
          <div className="pointer-events-none absolute inset-0 bg-brand-radial" />
          <div className="relative flex h-20 items-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Clínica Imuniza"
              className="h-48 w-auto max-w-none object-contain"
            />
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-brand-soft hover:text-brand-deep"
            >
              <item.icon className="h-4 w-4 text-slate-400 transition group-hover:text-brand" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-deep">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {user.role === 'admin'
                ? 'Administrador'
                : user.role === 'secretary'
                  ? 'Secretária'
                  : 'Atendente'}
            </span>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
        <InstanceStatusBanner show={user.role === 'admin'} />
        {children}
      </main>
    </div>
  );
}
