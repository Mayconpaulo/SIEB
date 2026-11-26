import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Clock, Plus, UserCheck } from 'lucide-react';
import { formatShortDatePt } from '../data/initialSchedules';
import {
  computeRestOrderCandidates,
  formatPersonnelDisplay,
  parseMilitaryInput,
  searchPersonnelSuggestions,
} from '../lib/matrixEngine';
import type {
  CalendarDayOverride,
  MissionRecord,
  PersonnelProfile,
  RestOrderCandidate,
  ScheduleEntry,
} from '../types/schedule';

export interface RestOrderContext {
  targetDate: string;
  isRedScale: boolean;
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  missions: MissionRecord[];
  calendarDays?: Record<string, CalendarDayOverride>;
  defaultRankFilter?: string;
}

interface PersonnelAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelectPerson?: (person: PersonnelProfile) => void;
  onQuickCreate?: (rawInput: string) => Promise<PersonnelProfile | null>;
  personnel: PersonnelProfile[];
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  compact?: boolean;
  excludeIds?: string[];
  className?: string;
  restOrderContext?: RestOrderContext;
}

interface DropdownPos {
  top: number;
  left: number;
  width: number;
  openUpward: boolean;
}

export const PersonnelAutocompleteInput: React.FC<PersonnelAutocompleteInputProps> = ({
  value,
  onChange,
  onSelectPerson,
  onQuickCreate,
  personnel,
  placeholder = 'Digite nome ou graduação...',
  ariaLabel,
  maxLength = 120,
  compact = false,
  excludeIds = [],
  className = '',
  restOrderContext,
}) => {
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const [selectedRankFilter, setSelectedRankFilter] = useState<string>(
    restOrderContext?.defaultRankFilter ?? 'all'
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const availablePool = useMemo(
    () => personnel.filter((p) => p.active && !excludeSet.has(p.id)),
    [personnel, excludeSet]
  );

  const availableRanks = useMemo(
    () =>
      Array.from(new Set(availablePool.map((p) => p.rank.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'pt-BR')
      ),
    [availablePool]
  );

  // Sync default rank filter when opening dropdown on a fresh cell
  useEffect(() => {
    if (open) {
      const def = restOrderContext?.defaultRankFilter ?? 'all';
      setSelectedRankFilter(def !== 'all' && availableRanks.includes(def) ? def : 'all');
    }
  }, [open, restOrderContext?.defaultRankFilter, availableRanks]);

  // Mode A: Rest-Order ranking (Ordem de Folga: Mais Folgado -> Menos Folgado)
  const restCandidates = useMemo<RestOrderCandidate[]>(() => {
    if (!restOrderContext) return [];
    return computeRestOrderCandidates({
      personnel: availablePool,
      entriesBySchedule: restOrderContext.entriesBySchedule,
      missions: restOrderContext.missions,
      calendarDays: restOrderContext.calendarDays,
      targetDate: restOrderContext.targetDate,
      isRedScale: restOrderContext.isRedScale,
      query: value,
      rankFilter: selectedRankFilter,
      excludeIds,
    }).slice(0, 14);
  }, [restOrderContext, availablePool, value, selectedRankFilter, excludeIds]);

  // Mode B: Standard alphabetical/relevance autocomplete (e.g. Missions / Leaves)
  const simpleSuggestions = useMemo(() => {
    if (restOrderContext) return [];
    return searchPersonnelSuggestions(value, availablePool, { limit: 7 });
  }, [restOrderContext, value, availablePool]);

  const displayedPeople: PersonnelProfile[] = useMemo(
    () => (restOrderContext ? restCandidates.map((c) => c.person) : simpleSuggestions),
    [restOrderContext, restCandidates, simpleSuggestions]
  );

  const parsedCandidate = useMemo(() => parseMilitaryInput(value), [value]);

  const hasExactMatch = useMemo(() => {
    if (!parsedCandidate) return true;
    return personnel.some(
      (p) =>
        p.normalizedKey === parsedCandidate.normalizedKey ||
        formatPersonnelDisplay(p).toUpperCase() === value.trim().toUpperCase()
    );
  }, [parsedCandidate, personnel, value]);

  const canQuickCreate = Boolean(onQuickCreate && parsedCandidate && !hasExactMatch);

  const showDropdown =
    open &&
    (displayedPeople.length > 0 ||
      canQuickCreate ||
      (Boolean(restOrderContext) && availablePool.length > 0));

  const updatePosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < 300 && rect.top > 300;
    const width = Math.max(rect.width, restOrderContext ? 310 : 236);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    setDropdownPos({
      top: openUpward ? rect.top - 4 : rect.bottom + 4,
      left: Math.min(rect.left, maxLeft),
      width,
      openUpward,
    });
  }, [restOrderContext]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [value, displayedPeople.length, selectedRankFilter]);

  useEffect(() => {
    if (!showDropdown) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [showDropdown, updatePosition]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleSelect = (person: PersonnelProfile) => {
    const formatted = formatPersonnelDisplay(person);
    onChange(formatted);
    onSelectPerson?.(person);
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!onQuickCreate || !parsedCandidate || creating) return;
    setCreating(true);
    try {
      const created = await onQuickCreate(value.trim());
      if (created) {
        onChange(formatPersonnelDisplay(created));
        onSelectPerson?.(created);
      }
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const totalItems = displayedPeople.length + (canQuickCreate ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || totalItems === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      if (highlightedIdx < displayedPeople.length) {
        e.preventDefault();
        handleSelect(displayedPeople[highlightedIdx]);
      } else if (canQuickCreate) {
        e.preventDefault();
        void handleCreate();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  let eligibleOrderCounter = 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={
          compact
            ? 'w-full min-h-[36px] px-2.5 py-1 text-xs sm:text-[13px] font-medium text-[#E4EAE6] placeholder:text-[#4F6056] bg-[#090F0C]/60 border border-transparent hover:border-[#EBE0C8]/22 focus:bg-[#080B09] focus:border-[#C8A461] focus:outline-none rounded-md transition-colors'
            : 'btl-input px-3.5 py-2'
        }
      />

      {showDropdown &&
        dropdownPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              transform: dropdownPos.openUpward ? 'translateY(-100%)' : undefined,
            }}
            className="z-[90] rounded-xl bg-[#0B130F]/98 border border-[#C9A961]/38 shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col max-h-80"
          >
            {/* Rest Order Header & Quick Rank Chips */}
            {restOrderContext && (
              <div className="px-3 py-2 bg-[#080E0B] border-b border-[#EBE0C8]/12 space-y-1.5 shrink-0">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-[#F4E6C4] flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-[#C8A461]" />
                    <span>Ordem de Folga</span>
                  </span>
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      restOrderContext.isRedScale
                        ? 'bg-[#7F1D1D]/45 text-[#FCA5A5] border-[#F87171]/35'
                        : 'bg-[#2D5A43]/40 text-[#A8D8BE] border-[#83B499]/35'
                    }`}
                  >
                    {restOrderContext.isRedScale ? 'Vermelha (V)' : 'Preta (P)'}
                  </span>
                </div>

                {availableRanks.length > 1 && (
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5 schedule-scroll">
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedRankFilter('all');
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                        selectedRankFilter === 'all'
                          ? 'bg-[#C8A461]/28 text-[#F4E6C4] border border-[#C8A461]/50'
                          : 'bg-[#121D17] text-[#98A89F] hover:text-[#E4EAE6] border border-transparent'
                      }`}
                    >
                      Todos
                    </button>
                    {availableRanks.map((rank) => (
                      <button
                        key={rank}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedRankFilter(rank);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                          selectedRankFilter === rank
                            ? 'bg-[#C8A461]/28 text-[#F4E6C4] border border-[#C8A461]/50'
                            : 'bg-[#121D17] text-[#98A89F] hover:text-[#E4EAE6] border border-transparent'
                        }`}
                      >
                        {rank}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-y-auto schedule-scroll py-1 flex-1">
              {restOrderContext
                ? restCandidates.map((cand, idx) => {
                    const isHighlighted = idx === highlightedIdx;
                    const rankPosition =
                      cand.eligibleForScale && !cand.busyOnTargetDate
                        ? ++eligibleOrderCounter
                        : null;

                    return (
                      <button
                        key={cand.person.id}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelect(cand.person);
                        }}
                        onMouseEnter={() => setHighlightedIdx(idx)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-[#2D5A43]/45 text-[#F4E6C4]'
                            : !cand.eligibleForScale
                            ? 'text-[#7D8F85] opacity-75 hover:bg-[#7F1D1D]/18'
                            : 'text-[#E4EAE6] hover:bg-[#E4EAE6]/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-mono text-[10px] font-bold w-5 shrink-0 text-center ${
                              rankPosition === 1
                                ? 'text-[#E5C17B]'
                                : rankPosition !== null
                                ? 'text-[#83B499]'
                                : 'text-[#697870]'
                            }`}
                          >
                            {rankPosition !== null ? `#${rankPosition}` : '—'}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {formatPersonnelDisplay(cand.person)}
                            </div>
                            {cand.person.company && (
                              <div className="text-[10px] text-[#7D8F85] truncate">
                                {cand.person.company}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {!cand.eligibleForScale ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#FCA5A5]">
                              <Ban className="w-3 h-3" />
                              <span>
                                {cand.person.scaleMode === 'red_only'
                                  ? 'Só Vermelha'
                                  : cand.person.scaleMode === 'black_only'
                                  ? 'Só Preta'
                                  : 'Não concorre'}
                              </span>
                            </span>
                          ) : cand.busyOnTargetDate ? (
                            <span className="text-[10px] font-medium text-[#E5C17B]">
                              {cand.busyReason}
                            </span>
                          ) : cand.daysSinceLastDuty === null ? (
                            <div className="text-[10px] font-semibold text-[#A8D8BE]">
                              Sem serviço
                            </div>
                          ) : (
                            <div>
                              <div className="font-mono text-[11px] font-bold text-[#A8D8BE] tabular-nums">
                                {cand.daysSinceLastDuty === 0
                                  ? '0d (Dobra)'
                                  : `${cand.daysSinceLastDuty}×1 (${cand.daysSinceLastDuty}d)`}
                              </div>
                              {cand.lastDutyDate && (
                                <div className="font-mono text-[9px] text-[#7D8F85] tabular-nums">
                                  Últ: {formatShortDatePt(cand.lastDutyDate)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })
                : simpleSuggestions.map((person, idx) => {
                    const isHighlighted = idx === highlightedIdx;
                    return (
                      <button
                        key={person.id}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelect(person);
                        }}
                        onMouseEnter={() => setHighlightedIdx(idx)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-[#2D5A43]/45 text-[#F4E6C4]'
                            : 'text-[#E4EAE6] hover:bg-[#E4EAE6]/[0.06]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {formatPersonnelDisplay(person)}
                          </div>
                          {(person.fullName.toUpperCase() !== person.warName.toUpperCase() ||
                            person.company) && (
                            <div className="text-[11px] text-[#98A89F] truncate">
                              {[
                                person.fullName.toUpperCase() !== person.warName.toUpperCase()
                                  ? person.fullName
                                  : null,
                                person.company || null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                        <UserCheck className="w-3.5 h-3.5 text-[#83B499] shrink-0 opacity-80" />
                      </button>
                    );
                  })}

              {restOrderContext && restCandidates.length === 0 && !canQuickCreate && (
                <div className="px-3 py-3 text-xs text-[#98A89F] text-center">
                  Nenhum militar encontrado para este filtro.
                </div>
              )}

              {canQuickCreate && parsedCandidate && (
                <button
                  type="button"
                  disabled={creating}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleCreate();
                  }}
                  onMouseEnter={() => setHighlightedIdx(displayedPeople.length)}
                  className={`w-full px-3 py-2.5 text-left flex items-center gap-2 text-xs border-t border-[#EBE0C8]/10 transition-colors cursor-pointer ${
                    highlightedIdx === displayedPeople.length
                      ? 'bg-[#C8A461]/22 text-[#F4E6C4]'
                      : 'text-[#E5C17B] hover:bg-[#C8A461]/14'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate font-medium">
                    {creating
                      ? 'Cadastrando...'
                      : `Cadastrar "${parsedCandidate.rank ? `${parsedCandidate.rank} ` : ''}${parsedCandidate.warName}"`}
                  </span>
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
