import { memo, useState } from 'react';
import { useIsPc } from '../utils/platform';
import { ROOM_CODE_REGEX } from '../game/multiplayerTypes';

const PURPLE_DOT_PATTERN =
  'radial-gradient(circle, rgba(142, 145, 218, 0.34) 1.45px, transparent 1.55px), radial-gradient(circle, rgba(142, 145, 218, 0.34) 1.45px, transparent 1.55px)';

const YELLOW_DOT_PATTERN =
  'radial-gradient(circle, rgba(217, 134, 0, 0.34) 1.45px, transparent 1.55px), radial-gradient(circle, rgba(217, 134, 0, 0.34) 1.45px, transparent 1.55px)';

interface CreatorServersModalProps {
  busy: boolean;
  errorMessage: string | null;
  onCreateServer: () => void;
  onJoinWithCode: (code: string) => void;
  onClearError: () => void;
  onBack: () => void;
}

export const CreatorServersModal = memo(function CreatorServersModal({
  busy,
  errorMessage,
  onCreateServer,
  onJoinWithCode,
  onClearError,
  onBack,
}: CreatorServersModalProps) {
  const isPc = useIsPc();
  const [mode, setMode] = useState<'root' | 'join'>('root');
  const [codeInput, setCodeInput] = useState('');

  const normalizedCode = codeInput.trim().toUpperCase();
  const isValidCode = ROOM_CODE_REGEX.test(normalizedCode);

  const handleSubmitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    onJoinWithCode(normalizedCode);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 select-none"
      style={{ backgroundColor: 'rgba(8, 12, 28, 0.78)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative w-full max-w-[400px] rounded-[14px] p-6 animate-cartoon-pop-in"
        style={{
          backgroundColor: '#232856',
          backgroundImage: PURPLE_DOT_PATTERN,
          backgroundSize: '12px 12px',
          backgroundPosition: '0 0, 6px 6px',
          border: '3px solid #0B0D18',
          boxShadow: '7px 8px 0 #0B0D18, inset 0 2px 0 rgba(190, 198, 255, 0.3)',
        }}
      >
        <h2
          className="mb-5 text-center font-cartoon text-[24px] font-bold italic uppercase tracking-wider text-[#FFD147]"
          style={{
            WebkitTextStroke: '3px #0B0D18',
            paintOrder: 'stroke fill',
            textShadow: '0 2px 0 #0B0D18',
          }}
        >
          Creator Servers
        </h2>

        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-[8px] px-3.5 py-2.5 text-center font-cartoon text-[13px] font-bold uppercase tracking-wide text-white"
            style={{
              backgroundColor: '#991B2C',
              border: '2px solid #0B0D18',
              boxShadow: '2px 3px 0 #0B0D18',
            }}
          >
            {errorMessage}
          </div>
        )}

        {mode === 'root' ? (
          <div className="flex flex-col gap-3.5">
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[9px]"
                style={{ backgroundColor: '#0B0D18', transform: 'translate(4px, 5px)' }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onClearError();
                  onCreateServer();
                }}
                className="relative z-10 w-full rounded-[9px] px-5 py-3.5 font-cartoon text-[18px] font-bold italic uppercase tracking-wider text-[#0B0D18] transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-60 cursor-pointer"
                style={{
                  backgroundColor: '#FFCC33',
                  backgroundImage: YELLOW_DOT_PATTERN,
                  backgroundSize: '10px 10px',
                  backgroundPosition: '0 0, 5px 5px',
                  border: '2.5px solid #0B0D18',
                  boxShadow:
                    'inset 0 -3px 0 #D99B00, inset 0 2px 0 rgba(255, 248, 205, 0.72)',
                }}
              >
                {busy ? 'Creating...' : 'Create Server'}
              </button>
            </div>

            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[9px]"
                style={{ backgroundColor: '#0B0D18', transform: 'translate(4px, 5px)' }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onClearError();
                  setMode('join');
                }}
                className="relative z-10 w-full rounded-[9px] px-5 py-3.5 font-cartoon text-[18px] font-bold italic uppercase tracking-wider text-white transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-60 cursor-pointer"
                style={{
                  backgroundColor: '#1E7A8C',
                  backgroundImage: PURPLE_DOT_PATTERN,
                  backgroundSize: '10px 10px',
                  backgroundPosition: '0 0, 5px 5px',
                  border: '2.5px solid #0B0D18',
                  boxShadow:
                    'inset 0 -3px 0 #114D59, inset 0 2px 0 rgba(168, 240, 255, 0.36)',
                  textShadow: '0 1.5px 0 #0B0D18',
                }}
              >
                Join With Code
              </button>
            </div>

            <div className="relative mt-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[9px]"
                style={{ backgroundColor: '#0B0D18', transform: 'translate(4px, 5px)' }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={onBack}
                className="relative z-10 w-full rounded-[9px] px-5 py-2.5 font-cartoon text-[15px] font-bold italic uppercase tracking-wider text-white transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-60 cursor-pointer"
                style={{
                  backgroundColor: '#353875',
                  border: '2.5px solid #0B0D18',
                  boxShadow:
                    'inset 0 -2px 0 #1F214C, inset 0 2px 0 rgba(185, 192, 250, 0.25)',
                  textShadow: '0 1px 0 #0B0D18',
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitJoin} className="flex flex-col gap-3.5">
            <input
              type="text"
              value={codeInput}
              maxLength={6}
              autoFocus={isPc}
              placeholder="ENTER 6-CHAR CODE"
              aria-label="Server Code"
              onChange={(e) => {
                onClearError();
                const cleaned = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 6);
                setCodeInput(cleaned);
              }}
              className="w-full rounded-[9px] px-4 py-3 text-center font-cartoon text-[22px] font-extrabold uppercase tracking-[0.26em] text-[#FFD147] placeholder:text-[13px] placeholder:tracking-widest placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD147]"
              style={{
                backgroundColor: '#121633',
                border: '2.5px solid #0B0D18',
                boxShadow: 'inset 0 3px 0 rgba(0, 0, 0, 0.45)',
              }}
            />

            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[9px]"
                style={{ backgroundColor: '#0B0D18', transform: 'translate(4px, 5px)' }}
              />
              <button
                type="submit"
                disabled={busy || !isValidCode}
                className="relative z-10 w-full rounded-[9px] px-5 py-3.5 font-cartoon text-[18px] font-bold italic uppercase tracking-wider text-[#0B0D18] transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-55 cursor-pointer"
                style={{
                  backgroundColor: '#FFCC33',
                  backgroundImage: YELLOW_DOT_PATTERN,
                  backgroundSize: '10px 10px',
                  backgroundPosition: '0 0, 5px 5px',
                  border: '2.5px solid #0B0D18',
                  boxShadow:
                    'inset 0 -3px 0 #D99B00, inset 0 2px 0 rgba(255, 248, 205, 0.72)',
                }}
              >
                {busy ? 'Joining...' : 'Join'}
              </button>
            </div>

            <div className="relative mt-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[9px]"
                style={{ backgroundColor: '#0B0D18', transform: 'translate(4px, 5px)' }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onClearError();
                  setMode('root');
                }}
                className="relative z-10 w-full rounded-[9px] px-5 py-2.5 font-cartoon text-[15px] font-bold italic uppercase tracking-wider text-white transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-60 cursor-pointer"
                style={{
                  backgroundColor: '#353875',
                  border: '2.5px solid #0B0D18',
                  boxShadow:
                    'inset 0 -2px 0 #1F214C, inset 0 2px 0 rgba(185, 192, 250, 0.25)',
                  textShadow: '0 1px 0 #0B0D18',
                }}
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
});
