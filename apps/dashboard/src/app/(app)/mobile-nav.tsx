'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutGrid, X } from 'lucide-react';
import { filterNavForRole, type NavItem } from './nav-items';

// Tabs fixas na barra inferior (mesmas para todos os perfis)
const primaryHrefs = ['/queue', '/patients', '/metrics', '/vaccines'] as const;

export function MobileNav({
  userName,
  userEmail,
  userRole,
  logoutSlot,
}: {
  userName: string;
  userEmail: string;
  userRole: 'admin' | 'attendant' | 'secretary';
  logoutSlot: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();

  const visibleNav = filterNavForRole(userRole);
  const primary = primaryHrefs
    .map((h) => visibleNav.find((i) => i.href === h))
    .filter(Boolean) as NavItem[];
  const secondary = visibleNav.filter((i) => !primaryHrefs.includes(i.href as (typeof primaryHrefs)[number]));

  // Fecha a sheet ao navegar
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Trava scroll quando sheet aberta
  useEffect(() => {
    if (moreOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [moreOpen]);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <>
      {/* Top bar mobile: logo + avatar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Imuniza" className="h-9 w-auto object-contain" />
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-deep">
          {userName.charAt(0).toUpperCase()}
        </div>
      </header>

      {/* Bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Navegação principal"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-around px-1 py-1.5">
          {primary.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium transition ${
                    active ? 'text-brand-deep' : 'text-slate-500 active:bg-slate-50'
                  }`}
                >
                  {active && (
                    <span
                      className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-brand"
                      aria-hidden
                    />
                  )}
                  <item.icon
                    className={`h-[22px] w-[22px] ${active ? 'text-brand' : 'text-slate-400'}`}
                  />
                  <span className="leading-tight">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              onClick={() => setMoreOpen(true)}
              className="flex w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium text-slate-500 transition active:bg-slate-50"
              aria-label="Abrir mais opções"
            >
              <LayoutGrid className="h-[22px] w-[22px] text-slate-400" />
              <span className="leading-tight">Mais</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Sheet "Mais" */}
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          role="presentation"
        />
      )}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] transform flex-col rounded-t-3xl bg-white shadow-premium transition-transform duration-200 lg:hidden ${
          moreOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-hidden={!moreOpen}
      >
        {/* Handle + header */}
        <div className="flex items-center justify-between px-5 pt-3">
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-slate-200" aria-hidden />
          <button
            onClick={() => setMoreOpen(false)}
            className="absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold text-slate-900">Mais opções</h2>
          <p className="text-xs text-slate-500">Acesso rápido ao sistema</p>
        </div>

        <div className="grid grid-cols-3 gap-2 overflow-y-auto px-4 pb-4">
          {secondary.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition ${
                  active
                    ? 'border-brand/30 bg-brand-soft text-brand-deep'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    active ? 'bg-brand/10 text-brand' : 'bg-white text-slate-600'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-deep">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">{userName}</div>
              <div className="truncate text-xs text-slate-500">{userEmail}</div>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {userRole === 'admin'
                ? 'Administrador'
                : userRole === 'secretary'
                  ? 'Secretária'
                  : 'Atendente'}
            </span>
          </div>
          <div className="mt-3 flex justify-end">{logoutSlot}</div>
        </div>
      </div>
    </>
  );
}
