import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import {
  subscribeAutoUpdateUiState,
  type AutoUpdateUiState,
} from '../lib/autoUpdate';
import { TRANSITION_MICRO } from '../lib/motion';

export const AutoUpdateBanner: React.FC = () => {
  const [state, setState] = useState<AutoUpdateUiState>({ status: 'idle' });

  useEffect(() => subscribeAutoUpdateUiState(setState), []);

  return (
    <AnimatePresence>
      {state.status !== 'idle' && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={TRANSITION_MICRO}
          className={`fixed bottom-20 md:bottom-5 right-4 left-4 md:left-auto z-[95] flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-medium shadow-2xl backdrop-blur-xl border ${
            state.status === 'updating'
              ? 'bg-[#17211B]/96 border-[#C9A961]/55 text-[#F4E6C4]'
              : 'bg-[#11241B]/96 border-[#83B499]/50 text-[#D4F0E0]'
          }`}
        >
          {state.status === 'updating' ? (
            <>
              <RefreshCw className="w-4 h-4 shrink-0 text-[#E5C17B] animate-spin" />
              <span>
                Nova atualização disponível — salvando sua tela e reiniciando automaticamente...
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#83B499]" />
              <span>SIEB atualizado — seu trabalho foi restaurado exatamente de onde parou.</span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
