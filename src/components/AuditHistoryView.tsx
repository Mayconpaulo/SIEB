import React from 'react';
import { Clock } from 'lucide-react';
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
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-[#141A16]">
          Histórico de Alterações
        </h1>
        <p className="text-sm text-[#4A554E]">
          Registro cronológico das modificações realizadas pela administração nas escalas de serviço.
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="bg-white border border-[#DCE1DC] rounded-xl p-10 text-center space-y-2">
          <Clock className="w-6 h-6 text-[#7A877E] mx-auto" />
          <p className="text-sm font-semibold text-[#141A16]">
            Nenhuma alteração registrada ainda
          </p>
          <p className="text-xs text-[#5A665E] max-w-md mx-auto">
            Assim que o administrador publicar ou editar escalas na Área Administrativa, cada modificação ficará registrada aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#DCE1DC] rounded-xl divide-y divide-[#EEF1EE] overflow-hidden">
          {logs.map((log) => (
            <div key={log.id} className="px-5 py-4 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A665E]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-[#1B4332]">
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#2A352E]">{log.scheduleName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{log.actorLabel}</span>
                </div>
                <time
                  dateTime={log.createdAt}
                  className="font-mono tabular-nums text-[#5A665E]"
                >
                  {formatDateTimePt(log.createdAt)}
                </time>
              </div>
              <p className="text-sm font-medium text-[#141A16]">{log.summary}</p>
              {log.details && (
                <p className="text-xs text-[#5A665E] leading-relaxed">{log.details}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
