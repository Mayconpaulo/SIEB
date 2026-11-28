import React from 'react';
import { CalendarDays, Home, Lock, LogOut, Search, TableProperties } from 'lucide-react';
import { motion } from 'motion/react';
import { SPRING_TAB } from '../lib/motion';

export type AppView = 'home' | 'schedules' | 'matrix' | 'search' | 'admin';

interface HeaderProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  isAdminActive: boolean;
  onAdminAction: () => void;
}

const NAV_ITEMS: { id: Exclude<AppView, 'admin'>; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'schedules', label: 'Escalas' },
  { id: 'matrix', label: 'Planilha' },
  { id: 'search', label: 'Buscar Militar' },
];

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onNavigate,
  isAdminActive,
  onAdminAction,
}) => {
  return (
    <header className="sticky top-0 z-30 btl-nav-bar border-b border-[#1F2924]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Crisp single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer group"
        >
          <span
            aria-hidden="true"
            className="w-7 h-7 rounded-md bg-[#13281E] border border-[#2D6248] flex items-center justify-center shrink-0"
          >
            <span className="w-2 h-2 rounded-[2px] bg-[#C8A45D]" />
          </span>
          <span className="font-display text-base sm:text-lg font-bold tracking-[0.08em] text-[#F1F5F3] group-hover:text-[#DFBE78] transition-colors">
            SIEB
          </span>
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#F1F5F3] font-semibold'
                    : 'text-[#A4B3AB] hover:text-[#F1F5F3]'
                }`}
              >
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="btl-nav-indicator"
                    transition={SPRING_TAB}
                    className="absolute left-0 right-0 -bottom-[15px] h-[2px] bg-[#C8A45D]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onAdminAction}
            className={`btl-btn min-h-[38px] px-3.5 sm:px-4 py-1.5 text-xs sm:text-sm ${
              isAdminActive ? 'btl-btn-danger' : 'btl-btn-gold'
            }`}
          >
            {isAdminActive ? (
              <>
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Sair do Admin</span>
                <span className="sm:hidden">Sair</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Área Administrativa</span>
                <span className="sm:hidden">Admin</span>
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
    { id: 'home', label: 'Início', icon: <Home className="w-[18px] h-[18px]" />, action: () => onNavigate('home') },
    { id: 'schedules', label: 'Escalas', icon: <CalendarDays className="w-[18px] h-[18px]" />, action: () => onNavigate('schedules') },
    { id: 'matrix', label: 'Planilha', icon: <TableProperties className="w-[18px] h-[18px]" />, action: () => onNavigate('matrix') },
    { id: 'search', label: 'Buscar', icon: <Search className="w-[18px] h-[18px]" />, action: () => onNavigate('search') },
    { id: 'admin', label: 'Admin', icon: <Lock className="w-[18px] h-[18px]" />, action: onAdminAction },
  ];

  return (
    <nav
      aria-label="Navegação móvel"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 btl-nav-bar border-t border-[#1F2924] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 h-14">
        {items.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.action}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors cursor-pointer ${
                isActive ? 'text-[#DFBE78] font-semibold' : 'text-[#84958C] hover:text-[#F1F5F3]'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="btl-mobile-nav-indicator"
                  transition={SPRING_TAB}
                  className="absolute top-0 left-3.5 right-3.5 h-[2px] bg-[#C8A45D]"
                />
              )}
              {item.icon}
              <span className="text-[11px] leading-tight whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
