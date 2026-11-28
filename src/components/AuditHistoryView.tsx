import React from 'react';
import { motion } from 'motion/react';
import { Clock } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '../lib/motion';
import type { AuditAction, AuditLogEntry } from '../types/schedule';

interface AuditHistoryViewProps {
  logs: AuditLogEntry[];
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create_schedule: 'Nova escala',
  update_schedule: 'Estrutura alterada',
  delete_schedule: 'Escala removida',
  update_entries: 'Escala atualizada',
  create_period: 'Novo período',
  delete_entry: 'Data removida',
  seed_initial: 'Carga inicial',
  create_personnel: 'Militar cadastrado',
  update_personnel: 'Militar atualizado',
  deactivate_personnel: 'Status de militar',
  import_personnel: 'Importação de efetivo',
  create_mission: 'Nova missão',
  update_mission: 'Missão alterada',
  delete_mission: 'Missão removida',
  create_leave: 'Folga registrada',
  delete_leave: 'Folga removida',
  update_calendar_day: 'Dia alterado',
  create_admin: 'Novo acesso admin',
  update_admin: 'Acesso admin alterado',
  delete_admin: 'Acesso admin removido',
};

function formatDateTimePt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export const AuditHistoryView: React.FC<AuditHistoryViewProps> = ({ logs }) => {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-[#F4E6C4]">
        Histórico de Alterações
      </h1>

      {logs.length === 0 ? (
        <div className="btl-card p-10 text-center space-y-2.5">
          <Clock className="w-6 h-6 text-[#C8A461] mx-auto" />
          <p className="text-sm font-semibold text-[#F4E6C4]">
            Nenhuma alteração registrada ainda
          </p>
          <p className="text-xs text-[#98A89F] max-w-md mx-auto leading-relaxed">
            Assim que o administrador publicar ou editar escalas na Área Administrativa, cada modificação ficará registrada aqui automaticamente.
          </p>
        </div>
      ) : (
        <motion.div
          variants={STAGGER_CONTAINER}
          initial="hidden"
          animate="show"
          className="btl-card divide-y divide-[#EBE0C8]/10 overflow-hidden"
        >
          {logs.map((log) => (
            <motion.div
              key={log.id}
              variants={STAGGER_ITEM}
              className="px-5 py-4 space-y-1.5 hover:bg-[#E4EAE6]/[0.025] transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#98A89F]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-[#E5C17B]">
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <span aria-hidden="true" className="text-[#697870]">·</span>
                  <span className="font-medium text-[#E4EAE6]">{log.scheduleName}</span>
                  <span aria-hidden="true" className="text-[#697870]">·</span>
                  <span>{log.actorLabel}</span>
                </div>
                <time
                  dateTime={log.createdAt}
                  className="font-mono tabular-nums text-[#7D8F85]"
                >
                  {formatDateTimePt(log.createdAt)}
                </time>
              </div>
              <p className="text-sm font-medium text-[#F4E6C4]">{log.summary}</p>
              {log.details && (
                <p className="text-xs text-[#98A89F] leading-relaxed">{log.details}</p>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
};
