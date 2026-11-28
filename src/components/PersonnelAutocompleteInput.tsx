import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Clock, Plus, UserCheck } from 'lucide-react';
import { formatShortDatePt } from '../data/initialSchedules';
import {
  computeRestOrderCandidates,
  formatPersonnelDisplay,
  parseMilitaryInput,
  searchPersonnelSuggestions,
  sortMilitaryRanks,
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
  const listRef = useRef<HTMLDivElement | null>(null);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const availablePool = useMemo(() => {
    if (!open) return [];
    return personnel.filter((p) => p.active && !excludeSet.has(p.id));
  }, [open, personnel, excludeSet]);

  const availableRanks = useMemo(() => {
    if (!open) return [];
    return sortMilitaryRanks(
      Array.from(new Set(availablePool.map((p) => p.rank.trim()).filter(Boolean)))
    );
  }, [open, availablePool]);

  // Sync default rank filter when opening dropdown on a fresh cell
  useEffect(() => {
    if (open) {
      const def = restOrderContext?.defaultRankFilter ?? 'all';
      setSelectedRankFilter(def !== 'all' && availableRanks.includes(def) ? def : 'all');
    }
  }, [open, restOrderContext?.defaultRankFilter, availableRanks]);

  const trimmedValue = value.trim();

  // Mode A: Rest-Order ranking (Ordem de Folga: Mais Folgado -> Menos Folgado) + progressive prefix filtering
  const allRestCandidates = useMemo<RestOrderCandidate[]>(() => {
    if (!open || !restOrderContext) return [];
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
    });
  }, [open, restOrderContext, availablePool, value, selectedRankFilter, excludeIds]);

  // Show ALL matching names when user starts typing (progressive narrowing), or top 60 when browsing empty
  const restCandidates = useMemo(
    () => allRestCandidates.slice(0, trimmedValue.length > 0 ? 300 : 60),
    [allRestCandidates, trimmedValue.length]
  );

  // If a rank chip filtered out all matches while user is typing, count how many match across all ranks
  const allRanksFallbackCount = useMemo(() => {
    if (!open || !restOrderContext || !trimmedValue || selectedRankFilter === 'all' || restCandidates.length > 0) {
      return 0;
    }
    return computeRestOrderCandidates({
      personnel: availablePool,
      entriesBySchedule: restOrderContext.entriesBySchedule,
      missions: restOrderContext.missions,
      calendarDays: restOrderContext.calendarDays,
      targetDate: restOrderContext.targetDate,
      isRedScale: restOrderContext.isRedScale,
      query: value,
      rankFilter: 'all',
      excludeIds,
    }).length;
  }, [
    open,
    restOrderContext,
    trimmedValue,
    selectedRankFilter,
    restCandidates.length,
    availablePool,
    value,
    excludeIds,
  ]);

  // Mode B: Progressive prefix autocomplete (e.g. Missions)
  const simpleSuggestions = useMemo(() => {
    if (!open || restOrderContext) return [];
    return searchPersonnelSuggestions(value, availablePool, {
      limit: trimmedValue.length > 0 ? 200 : 50,
    });
  }, [open, restOrderContext, value, availablePool, trimmedValue.length]);

  const displayedPeople: PersonnelProfile[] = useMemo(
    () => (restOrderContext ? restCandidates.map((c) => c.person) : simpleSuggestions),
    [restOrderContext, restCandidates, simpleSuggestions]
  );

  const parsedCandidate = useMemo(
    () => (open ? parseMilitaryInput(value) : null),
    [open, value]
  );

  const hasExactMatch = useMemo(() => {
    if (!open || !parsedCandidate) return true;
    const upper = trimmedValue.toUpperCase();
    return personnel.some(
      (p) =>
        p.normalizedKey === parsedCandidate.normalizedKey ||
        formatPersonnelDisplay(p).toUpperCase() === upper
    );
  }, [open, parsedCandidate, personnel, trimmedValue]);

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
    const openUpward = spaceBelow < 320 && rect.top > 320;
    const width = Math.max(rect.width, restOrderContext ? 336 : 268);
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
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [value, displayedPeople.length, selectedRankFilter]);

  useEffect(() => {
    if (!showDropdown || !listRef.current) return;
    const activeOption = listRef.current.querySelector<HTMLElement>(
      `[data-option-idx="${highlightedIdx}"]`
    );
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIdx, showDropdown]);

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
    if (!open) return;
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
  }, [open]);

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
      const created = await onQuickCreate(trimmedValue);
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
            ? 'w-full min-h-[36px] px-2.5 py-1 text-xs sm:text-[13px] font-medium text-[#F1F5F3] placeholder:text-[#55665E] bg-[#0D1210] border border-transparent hover:border-[#28352F] focus:bg-[#0A0D0C] focus:border-[#C8A45D] focus:outline-none rounded-md transition-colors'
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
            className="z-[90] rounded-xl bg-[#111614] border border-[#28352F] shadow-[0_18px_40px_rgba(0,0,0,0.65)] overflow-hidden flex flex-col max-h-80"
          >
            {/* Rest Order Header & Quick Rank Chips */}
            {restOrderContext ? (
              <div className="px-3 py-2 bg-[#161D1A] border-b border-[#1F2924] space-y-1.5 shrink-0">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-[#F1F5F3] flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-[#C8A45D]" />
                    <span>
                      Ordem de Folga
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-[#A4B3AB]">
                        ({allRestCandidates.length})
                      </span>
                    </span>
                  </span>
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      restOrderContext.isRedScale
                        ? 'bg-[#241214] text-[#FCA5A5] border-[#5A262B]'
                        : 'bg-[#13281E] text-[#8CC4A7] border-[#2D6248]'
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
                          ? 'bg-[#1C2521] text-[#DFBE78] border border-[#63512C]'
                          : 'bg-[#0D1210] text-[#A4B3AB] hover:text-[#F1F5F3] border border-[#1F2924]'
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
                            ? 'bg-[#1C2521] text-[#DFBE78] border border-[#63512C]'
                            : 'bg-[#0D1210] text-[#A4B3AB] hover:text-[#F1F5F3] border border-[#1F2924]'
                        }`}
                      >
                        {rank}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              trimmedValue.length > 0 && (
                <div className="px-3 py-1.5 bg-[#161D1A] border-b border-[#1F2924] flex items-center justify-between text-[10px] text-[#A4B3AB] font-mono shrink-0">
                  <span>Efetivo filtrado</span>
                  <span className="text-[#DFBE78] font-semibold">
                    {simpleSuggestions.length} {simpleSuggestions.length === 1 ? 'militar' : 'militares'}
                  </span>
                </div>
              )
            )}

            <div ref={listRef} className="overflow-y-auto schedule-scroll py-1 flex-1">
              {restOrderContext
                ? restCandidates.map((cand, idx) => {
                    const isHighlighted = idx === highlightedIdx;
                    const rankPosition =
                      cand.eligibleForScale && !cand.busyOnTargetDate
                        ? ++eligibleOrderCounter
                        : null;
                    const showFullName =
                      cand.person.fullName.toUpperCase() !== cand.person.warName.toUpperCase();

                    return (
                      <button
                        key={cand.person.id}
                        type="button"
                        role="option"
                        data-option-idx={idx}
                        aria-selected={isHighlighted}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelect(cand.person);
                        }}
                        onMouseEnter={() => setHighlightedIdx(idx)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-[#13281E] text-[#F1F5F3]'
                            : !cand.eligibleForScale
                            ? 'text-[#6E7E76] opacity-75 hover:bg-[#241214]'
                            : 'text-[#F1F5F3] hover:bg-[#161D1A]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-mono text-[10px] font-bold w-6 shrink-0 text-center ${
                              rankPosition === 1
                                ? 'text-[#DFBE78]'
                                : rankPosition !== null
                                ? 'text-[#8CC4A7]'
                                : 'text-[#55665E]'
                            }`}
                          >
                            {rankPosition !== null ? `#${rankPosition}` : '—'}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {formatPersonnelDisplay(cand.person)}
                            </div>
                            {(showFullName || cand.person.company) && (
                              <div className="text-[10px] text-[#6E7E76] truncate">
                                {[showFullName ? cand.person.fullName : null, cand.person.company || null]
                                  .filter(Boolean)
                                  .join(' · ')}
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
                            <span className="text-[10px] font-medium text-[#DFBE78]">
                              {cand.busyReason}
                            </span>
                          ) : cand.daysSinceLastDuty === null ? (
                            <div className="text-[10px] font-semibold text-[#8CC4A7]">
                              Sem serviço
                            </div>
                          ) : (
                            <div>
                              <div className="font-mono text-[11px] font-bold text-[#8CC4A7] tabular-nums">
                                {cand.daysSinceLastDuty === 0
                                  ? '0d (Dobra)'
                                  : `${cand.daysSinceLastDuty}×1 (${cand.daysSinceLastDuty}d)`}
                              </div>
                              {cand.lastDutyDate && (
                                <div className="font-mono text-[9px] text-[#6E7E76] tabular-nums">
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
                        data-option-idx={idx}
                        aria-selected={isHighlighted}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelect(person);
                        }}
                        onMouseEnter={() => setHighlightedIdx(idx)}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-[#13281E] text-[#F1F5F3]'
                            : 'text-[#F1F5F3] hover:bg-[#161D1A]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {formatPersonnelDisplay(person)}
                          </div>
                          {(person.fullName.toUpperCase() !== person.warName.toUpperCase() ||
                            person.company) && (
                            <div className="text-[11px] text-[#A4B3AB] truncate">
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
                        <UserCheck className="w-3.5 h-3.5 text-[#8CC4A7] shrink-0" />
                      </button>
                    );
                  })}

              {restOrderContext && restCandidates.length === 0 && (
                <div className="px-3 py-3 text-xs text-[#A4B3AB] text-center space-y-2">
                  <div>Nenhum militar encontrado em {selectedRankFilter === 'all' ? 'todo o efetivo' : selectedRankFilter}.</div>
                  {allRanksFallbackCount > 0 && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedRankFilter('all');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1C1810] hover:bg-[#252014] border border-[#63512C] text-[#DFBE78] text-[11px] font-medium cursor-pointer transition-colors"
                    >
                      <span>Ver em todas as graduações ({allRanksFallbackCount})</span>
                    </button>
                  )}
                </div>
              )}

              {canQuickCreate && parsedCandidate && (
                <button
                  type="button"
                  data-option-idx={displayedPeople.length}
                  disabled={creating}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleCreate();
                  }}
                  onMouseEnter={() => setHighlightedIdx(displayedPeople.length)}
                  className={`w-full px-3 py-2.5 text-left flex items-center gap-2 text-xs border-t border-[#1F2924] transition-colors cursor-pointer ${
                    highlightedIdx === displayedPeople.length
                      ? 'bg-[#1C1810] text-[#F1F5F3]'
                      : 'text-[#DFBE78] hover:bg-[#1C1810]'
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

