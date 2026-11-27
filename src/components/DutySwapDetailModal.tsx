import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, CalendarDays, ShieldCheck, X } from 'lucide-react';
import { formatFullDatePt } from '../data/initialSchedules';
import { parseDutyCell } from '../lib/matrixEngine';
import { SPRING_MODAL, TRANSITION_MICRO } from '../lib/motion';

export interface SwapDetailTarget {
  scheduleName: string;
  columnLabel: string;
  date: string;
  scheduledLabel: string;
  substituteLabel: string;
}

interface DutySwapDetailModalProps {
  detail: SwapDetailTarget | null;
  onClose: () => void;
}

export const DutySwapDetailModal: React.FC<DutySwapDetailModalProps> = ({ detail, onClose }) => {
  return (
    <AnimatePresence>
      {detail && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={TRANSITION_MICRO}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="swap-detail-title"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={SPRING_MODAL}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md btl-modal overflow-hidden"
          >
            <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#38BDF8]/30 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#075985]/35 border border-[#38BDF8]/45 text-[#7DD3FC] shrink-0">
                  <ArrowLeftRight className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h3
                    id="swap-detail-title"
                    className="font-display text-base font-semibold text-[#F4E6C4] truncate"
                  >
                    Troca de Serviço
                  </h3>
                  <p className="text-xs text-[#98A89F] truncate">
                    {detail.scheduleName} · {detail.columnLabel}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-[#98A89F] hover:text-[#F4E6C4] rounded-lg cursor-pointer"
                aria-label="Fechar detalhes da troca"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs text-[#C8D4CD] font-mono tabular-nums">
                <CalendarDays className="w-4 h-4 text-[#E5C17B] shrink-0" />
                <span>{formatFullDatePt(detail.date)}</span>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-[#2D5A43]/22 border border-[#83B499]/35 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#A8D8BE]">
                    Deveria estar escalado (conta na escala)
                  </div>
                  <div className="text-base font-bold text-[#F4E6C4]">
                    {detail.scheduledLabel}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#075985]/26 border border-[#38BDF8]/45 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7DD3FC]">
                    Ficou no lugar (troca)
                  </div>
                  <div className="text-base font-bold text-[#E0F2FE]">
                    {detail.substituteLabel}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs text-[#98A89F] leading-relaxed pt-1">
                <ShieldCheck className="w-4 h-4 text-[#C8A461] shrink-0 mt-0.5" />
                <span>
                  Este serviço conta exclusivamente na escala e na folga de{' '}
                  <strong className="text-[#F4E6C4]">{detail.scheduledLabel}</strong>, sem
                  alterar a folga de{' '}
                  <strong className="text-[#7DD3FC]">{detail.substituteLabel}</strong>.
                </span>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="btl-btn btl-btn-secondary text-sm px-4"
              >
                Fechar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface DutyAssignmentBadgeProps {
  rawValue: string;
  highlightTerm?: string;
  onInspectSwap?: (scheduledLabel: string, substituteLabel: string) => void;
  emptyFallback?: React.ReactNode;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export const DutyAssignmentBadge: React.FC<DutyAssignmentBadgeProps> = ({
  rawValue,
  highlightTerm = '',
  onInspectSwap,
  emptyFallback = <span className="text-[#4F6056] select-none">—</span>,
}) => {
  const parsed = parseDutyCell(rawValue);
  if (!parsed.raw) {
    return <>{emptyFallback}</>;
  }

  const isMatch =
    highlightTerm.length > 0 && normalizeForMatch(parsed.raw).includes(highlightTerm);

  if (parsed.isSwap && parsed.substituteLabel) {
    const subLabel = parsed.substituteLabel;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onInspectSwap?.(parsed.scheduledLabel, subLabel);
        }}
        title={`Troca de serviço (escalado: ${parsed.scheduledLabel}) — clique para detalhes`}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-left font-semibold text-[#7DD3FC] bg-[#075985]/28 border-[#38BDF8]/48 hover:bg-[#075985]/45 hover:border-[#7DD3FC]/75 transition-colors cursor-pointer ${
          isMatch ? 'ring-2 ring-[#E5C17B]/70' : ''
        }`}
      >
        <ArrowLeftRight className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
        <span>{parsed.substituteLabel}</span>
      </button>
    );
  }

  const highlightClass = isMatch
    ? 'bg-[#C8A461]/30 text-[#F4E6C4] ring-1 ring-[#E5C17B]/40 px-1.5 py-0.5 -mx-1 rounded'
    : '';

  return (
    <span className={`font-semibold text-[#E4EAE6] ${highlightClass}`}>
      {parsed.scheduledLabel}
    </span>
  );
};
