import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { AdminAuthModal } from './components/AdminAuthModal';
import { AdminDashboard } from './components/AdminDashboard';
import { DynamicMatrixView } from './components/DynamicMatrixView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header, MobileBottomNav, type AppView } from './components/Header';
import { HomeOverview } from './components/HomeOverview';
import { OfflineIndicator } from './components/PWAInstallButton';
import { ScheduleViewer } from './components/ScheduleViewer';
import { SoldierSearchView } from './components/SoldierSearchView';
import { getTodayIsoLocal, INITIAL_SCHEDULES } from './data/initialSchedules';
import { logoutAdminToken } from './lib/adminApi';
import { auth } from './lib/firebase';
import { TRANSITION_VIEW, VIEW_VARIANTS } from './lib/motion';
import {
  subscribeToCalendarDays,
  subscribeToLeaves,
  subscribeToMissions,
  subscribeToPersonnel,
} from './lib/personnelService';
import {
  subscribeToAuditLogs,
  subscribeToScheduleEntries,
  subscribeToSchedules,
} from './lib/scheduleService';
import type {
  AuditLogEntry,
  CalendarDayOverride,
  LeaveRecord,
  MissionRecord,
  PersonnelProfile,
  ScheduleEntry,
  ScheduleModel,
} from './types/schedule';

export default function App() {
  const todayIso = useMemo(() => getTodayIsoLocal(), []);

  const [activeView, setActiveView] = useState<AppView>('home');
  const [schedules, setSchedules] = useState<ScheduleModel[]>(INITIAL_SCHEDULES);
  const [isCloudSynced, setIsCloudSynced] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [entriesBySchedule, setEntriesBySchedule] = useState<Record<string, ScheduleEntry[]>>({});
  const [personnel, setPersonnel] = useState<PersonnelProfile[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [calendarDays, setCalendarDays] = useState<Record<string, CalendarDayOverride>>({});
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Viewer state
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(INITIAL_SCHEDULES[0].id);
  const [viewMode, setViewMode] = useState<'table' | 'daily'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'daily' : 'table'
  );
  const [focusedDate, setFocusedDate] = useState<string>(todayIso);
  const [searchSeedQuery, setSearchSeedQuery] = useState<string>('');

  // Admin session (held strictly in JS memory — NEVER persisted in localStorage/sessionStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  // Real-time subscription to schedules list
  useEffect(() => {
    const unsub = subscribeToSchedules(
      (list, fromCloud) => {
        setSchedules(list);
        setIsCloudSynced(fromCloud);
        setLoadingSchedules(false);
        setSelectedScheduleId((prev) =>
          list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''
        );
      },
      () => {
        setLoadingSchedules(false);
      }
    );
    return () => unsub();
  }, []);

  // Real-time subscription to entries for every active schedule
  useEffect(() => {
    const unsubscribers = schedules.map((schedule) =>
      subscribeToScheduleEntries(schedule.id, isCloudSynced, (entries) => {
        setEntriesBySchedule((prev) => ({
          ...prev,
          [schedule.id]: entries,
        }));
      })
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [schedules, isCloudSynced]);

  // Real-time subscriptions to centralized personnel, missions, and official leaves
  const isAdminSessionActive = activeView === 'admin' && Boolean(adminToken);

  useEffect(() => {
    const unsubPersonnel = subscribeToPersonnel(isAdminSessionActive, setPersonnel);
    const unsubMissions = subscribeToMissions(isAdminSessionActive, setMissions);
    const unsubLeaves = subscribeToLeaves(isAdminSessionActive, setLeaves);
    const unsubCalendarDays = subscribeToCalendarDays(setCalendarDays);
    return () => {
      unsubPersonnel();
      unsubMissions();
      unsubLeaves();
      unsubCalendarDays();
    };
  }, [isAdminSessionActive]);

  // Real-time subscription to audit logs — strictly restricted to authenticated Admin sessions
  useEffect(() => {
    if (!isAdminSessionActive) {
      setAuditLogs([]);
      return;
    }
    const unsub = subscribeToAuditLogs((logs) => {
      setAuditLogs(logs);
    });
    return () => {
      unsub();
      setAuditLogs([]);
    };
  }, [isAdminSessionActive]);

  // Revoke server session immediately when exiting Admin Area (forces password on every re-entry)
  const terminateAdminSession = useCallback(async () => {
    const tokenToRevoke = adminTokenRef.current;
    setAdminToken(null);
    if (tokenToRevoke) {
      await logoutAdminToken(tokenToRevoke, true);
    }
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch {
      // Ignore Firebase signOut errors
    }
  }, []);

  // Revoke active server session if user closes/refreshes tab
  useEffect(() => {
    const handleUnload = () => {
      const token = adminTokenRef.current;
      if (token) {
        void logoutAdminToken(token, true);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Leaving Admin Area to any viewer tab ALWAYS revokes the admin session per requirement #1
  const handleNavigate = (target: AppView) => {
    if (activeView === 'admin' && target !== 'admin') {
      void terminateAdminSession();
    }
    setActiveView(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminButtonClick = () => {
    if (activeView === 'admin' && adminToken) {
      void terminateAdminSession();
      setActiveView('home');
      return;
    }
    // Always demand password before entering Admin Area
    setShowAdminModal(true);
  };

  const handleOpenSchedule = (
    scheduleId: string,
    preferredMode?: 'table' | 'daily',
    focusDate?: string
  ) => {
    setSelectedScheduleId(scheduleId);
    if (preferredMode) setViewMode(preferredMode);
    if (focusDate) setFocusedDate(focusDate);
    handleNavigate('schedules');
  };

  const handleOpenSearch = (initialQuery = '') => {
    setSearchSeedQuery(initialQuery);
    handleNavigate('search');
  };

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <div className="min-h-screen flex flex-col bg-transparent text-[#E4EAE6]">
          <Header
            activeView={activeView}
            onNavigate={(v) => handleNavigate(v)}
            isAdminActive={activeView === 'admin' && Boolean(adminToken)}
            onAdminAction={handleAdminButtonClick}
          />

          <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 md:pb-12">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                variants={VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={TRANSITION_VIEW}
              >
                {activeView === 'home' && (
                  <HomeOverview
                    schedules={schedules}
                    entriesBySchedule={entriesBySchedule}
                    todayIso={todayIso}
                    loading={loadingSchedules}
                    onOpenSchedule={handleOpenSchedule}
                    onOpenSearch={handleOpenSearch}
                  />
                )}

                {activeView === 'schedules' && (
                  <ScheduleViewer
                    schedules={schedules}
                    selectedScheduleId={selectedScheduleId}
                    onSelectSchedule={setSelectedScheduleId}
                    entries={entriesBySchedule[selectedScheduleId] ?? []}
                    todayIso={todayIso}
                    viewMode={viewMode}
                    onChangeViewMode={setViewMode}
                    focusedDate={focusedDate}
                    onChangeFocusedDate={setFocusedDate}
                  />
                )}

                {activeView === 'matrix' && (
                  <DynamicMatrixView
                    personnel={personnel}
                    schedules={schedules}
                    entriesBySchedule={entriesBySchedule}
                    missions={missions}
                    leaves={leaves}
                    calendarDays={calendarDays}
                    todayIso={todayIso}
                  />
                )}

                {activeView === 'search' && (
                  <SoldierSearchView
                    schedules={schedules}
                    entriesBySchedule={entriesBySchedule}
                    initialQuery={searchSeedQuery}
                    todayIso={todayIso}
                    onJumpToDuty={(scheduleId, dateIso) =>
                      handleOpenSchedule(
                        scheduleId,
                        window.innerWidth < 640 ? 'daily' : 'table',
                        dateIso
                      )
                    }
                  />
                )}

                {activeView === 'admin' && adminToken && (
                  <AdminDashboard
                    adminToken={adminToken}
                    isCloudSynced={isCloudSynced}
                    schedules={schedules}
                    entriesBySchedule={entriesBySchedule}
                    personnel={personnel}
                    missions={missions}
                    leaves={leaves}
                    calendarDays={calendarDays}
                    auditLogs={auditLogs}
                    todayIso={todayIso}
                    onSessionExpired={() => {
                      void terminateAdminSession();
                      setActiveView('home');
                      setShowAdminModal(true);
                    }}
                    onExitAdmin={() => {
                      void terminateAdminSession();
                      setActiveView('home');
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          <footer className="hidden md:block border-t border-[#EBE0C8]/10 bg-[#080B09]/65 backdrop-blur-md">
            <div className="max-w-7xl mx-auto px-6 lg:px-8 py-4 flex items-center justify-between text-xs text-[#7D8F85]">
              <span className="text-[#98A89F]">
                <strong className="text-[#F4E6C4] font-semibold">SIEB</strong> · Sistema Integrado de Escalas do Batalhão
              </span>
            </div>
          </footer>

          <MobileBottomNav
            activeView={activeView}
            onNavigate={(v) => handleNavigate(v)}
            onAdminAction={handleAdminButtonClick}
          />

          <AdminAuthModal
            isOpen={showAdminModal}
            onClose={() => setShowAdminModal(false)}
            onAuthenticated={(token) => {
              setAdminToken(token);
              setShowAdminModal(false);
              setActiveView('admin');
            }}
          />

          <OfflineIndicator />
        </div>
      </ErrorBoundary>
    </MotionConfig>
  );
}
