import React from 'react';
import { CalendarDays, History, Home, Lock, LogOut, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { SPRING_TAB } from '../lib/motion';

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
    <header className="sticky top-0 z-30 btl-liquid-bar border-b border-[#EBE0C8]/12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-15 md:h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Clean single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="font-display text-base sm:text-lg font-bold tracking-tight text-[#F4E6C4] hover:text-[#E5C17B] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C8A461]"
        >
          Escalas do Batalhão
        </button>

        {/* Zone 2: Clean single-line text navigation links with sliding gold indicator */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C8A461] ${
                  isActive
                    ? 'text-[#F4E6C4] font-semibold'
                    : 'text-[#98A89F] hover:text-[#E4EAE6]'
                }`}
              >
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="btl-nav-indicator"
                    transition={SPRING_TAB}
                    className="absolute left-0 right-0 -bottom-[15px] h-[2px] bg-gradient-to-r from-[#C8A461]/40 via-[#E5C17B] to-[#C8A461]/40 rounded-full"
                  />
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
            className={`btl-btn min-h-[40px] px-4 py-2 text-xs sm:text-sm ${
              isAdminActive ? 'btl-btn-danger' : 'btl-btn-gold'
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
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 btl-liquid-bar border-t border-[#EBE0C8]/14 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 h-15">
        {items.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.action}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors cursor-pointer ${
                isActive ? 'text-[#E5C17B] font-semibold' : 'text-[#8EA196] hover:text-[#E4EAE6]'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="btl-mobile-nav-indicator"
                  transition={SPRING_TAB}
                  className="absolute top-0 left-4 right-4 h-[2px] bg-[#E5C17B] rounded-full"
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
