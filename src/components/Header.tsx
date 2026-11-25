import React from 'react';
import { CalendarDays, History, Home, Lock, LogOut, Search } from 'lucide-react';

export type AppView = 'home' | 'schedules' | 'search' | 'history' | 'admin';

interface HeaderProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  isAdminActive: boolean;
  onAdminAction: () => void;
}

const NAV_ITEMS: { id: Exclude<AppView, 'admin'>; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'schedules', label: 'Escalas' },
  { id: 'search', label: 'Buscar Militar' },
  { id: 'history', label: 'Histórico' },
];

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onNavigate,
  isAdminActive,
  onAdminAction,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E2E6E2]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 md:h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Clean single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="font-display text-base sm:text-lg font-bold tracking-tight text-[#141A16] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4332]"
        >
          Escalas do Batalhão
        </button>

        {/* Zone 2: Clean single-line text navigation links (Desktop / Tablet) */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4332] ${
                  isActive
                    ? 'text-[#1B4332] font-semibold'
                    : 'text-[#4A554E] hover:text-[#141A16]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute left-0 right-0 -bottom-[19px] h-[2px] bg-[#1B4332]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onAdminAction}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4332] ${
              isAdminActive
                ? 'bg-[#B91C1C] text-white hover:bg-[#991B1B]'
                : 'bg-[#16201A] text-white hover:bg-[#1B4332]'
            }`}
          >
            {isAdminActive ? (
              <>
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Sair do Admin</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Área Administrativa</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export const MobileBottomNav: React.FC<{
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onAdminAction: () => void;
}> = ({ activeView, onNavigate, onAdminAction }) => {
  const items: { id: AppView; label: string; icon: React.ReactNode; action: () => void }[] = [
    { id: 'home', label: 'Início', icon: <Home className="w-5 h-5" />, action: () => onNavigate('home') },
    { id: 'schedules', label: 'Escalas', icon: <CalendarDays className="w-5 h-5" />, action: () => onNavigate('schedules') },
    { id: 'search', label: 'Buscar', icon: <Search className="w-5 h-5" />, action: () => onNavigate('search') },
    { id: 'history', label: 'Histórico', icon: <History className="w-5 h-5" />, action: () => onNavigate('history') },
    { id: 'admin', label: 'Admin', icon: <Lock className="w-5 h-5" />, action: onAdminAction },
  ];

  return (
    <nav
      aria-label="Navegação móvel"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#E2E6E2] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 h-15">
        {items.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.action}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors cursor-pointer ${
                isActive ? 'text-[#1B4332] font-semibold' : 'text-[#5A665E]'
              }`}
            >
              {item.icon}
              <span className="text-[11px] leading-tight whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
