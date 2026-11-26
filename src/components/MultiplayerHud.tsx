import { memo, useState } from 'react';
import type { ConnectionStatus, RoomSnapshot } from '../game/multiplayerTypes';
import type { MultiplayerToastEvent } from '../game/multiplayerClient';
import { useIsPc } from '../utils/platform';

const PURPLE_DOT_PATTERN =
  'radial-gradient(circle, rgba(142, 145, 218, 0.28) 1.3px, transparent 1.4px), radial-gradient(circle, rgba(142, 145, 218, 0.28) 1.3px, transparent 1.4px)';

interface MultiplayerHudProps {
  room: RoomSnapshot;
  selfPlayerId: string | null;
  connectionStatus: ConnectionStatus;
  toasts: MultiplayerToastEvent[];
  removingNpcs: boolean;
  onRemoveNpcs: () => void;
  onLeaveServer: () => void;
}

export const MultiplayerHud = memo(function MultiplayerHud({
  room,
  selfPlayerId,
  connectionStatus,
  toasts,
  removingNpcs,
  onRemoveNpcs,
  onLeaveServer,
}: MultiplayerHudProps) {
  const isPc = useIsPc();
  const [listOpen, setListOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwner = Boolean(selfPlayerId && room.ownerPlayerId === selfPlayerId);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Fallback ignored safely in restricted contexts
    }
  };

  return (
    <>
      {/* Reconnecting / Disconnected Status Pill */}
      {(connectionStatus === 'reconnecting' || connectionStatus === 'disconnected') && (
        <div
          role="status"
          className="pointer-events-none fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-[7px] px-4 py-1.5 font-cartoon text-[12px] font-bold italic uppercase tracking-wide text-white"
          style={{
            backgroundColor: '#991B2C',
            border: '2px solid #0B0D18',
            boxShadow: '2px 3px 0 #0B0D18',
          }}
        >
          {connectionStatus === 'reconnecting'
            ? 'Reconnecting to Server...'
            : 'Disconnected from Server'}
        </div>
      )}

      {/* Join / Leave / Room Toast Notifications */}
      {toasts.length > 0 && (
        <div
          className="pointer-events-none fixed right-4 z-30 flex flex-col items-end gap-1.5"
          style={{
            top: isPc
              ? 'calc(max(20px, var(--stage-safe-top, 0px)) + 76px)'
              : 'calc(max(6px, var(--stage-safe-top, 0px)) + 48px)',
          }}
        >
          {toasts.slice(-3).map((t) => (
            <div
              key={t.id}
              className="animate-cartoon-pop-in rounded-[6px] px-3 py-1 font-cartoon text-[11px] font-bold italic uppercase tracking-wide text-white"
              style={{
                backgroundColor:
                  t.tone === 'error'
                    ? '#991B2C'
                    : t.tone === 'warning'
                      ? '#8A5200'
                      : t.tone === 'success'
                        ? '#176645'
                        : '#252957',
                border: '2px solid #0B0D18',
                boxShadow: '2px 2.5px 0 #0B0D18',
                textShadow: '0 1px 0 #0B0D18',
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* Bottom-Right Minimal Server Panel (above Sprint/Jump/Aux stack so zero overlap) */}
      <div
        className="fixed z-30 flex flex-col items-end gap-2 select-none"
        style={{
          right: isPc
            ? 'var(--pc-edge-r, 28px)'
            : 'max(14px, calc(var(--stage-safe-right, 0px) + 10px))',
          bottom: isPc
            ? 'calc(var(--pc-edge-b, 28px) + var(--pc-slot, 94px) + var(--pc-row-gap, 18px) + var(--pc-sub, 82px) + 14px)'
            : 'calc(max(18px, calc(var(--stage-safe-bottom, 0px) + 12px)) + clamp(50px, 7.8vw, 60px) + clamp(54px, 8.4vw, 66px) + clamp(50px, 7.8vw, 62px) + 26px)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onPointerCancel={(e) => e.stopPropagation()}
      >
        {/* Expandable Minimal Player List */}
        {listOpen && (
          <div
            className="animate-cartoon-pop-in w-[228px] rounded-[9px] p-2.5"
            style={{
              backgroundColor: '#1E234D',
              backgroundImage: PURPLE_DOT_PATTERN,
              backgroundSize: '10px 10px',
              backgroundPosition: '0 0, 5px 5px',
              border: '2.5px solid #0B0D18',
              boxShadow: '4px 5px 0 #0B0D18',
            }}
          >
            <div className="mb-1.5 flex items-center justify-between border-b border-white/15 pb-1">
              <span className="font-cartoon text-[11px] font-bold uppercase tracking-wider text-[#FFD147]">
                Players ({room.players.length}/{room.maxPlayers})
              </span>
              <span className="font-cartoon text-[10px] font-bold uppercase text-slate-300">
                {room.npcsRemoved ? 'Bosses Off' : 'Bosses On'}
              </span>
            </div>
            <ul className="flex max-h-[168px] flex-col gap-1 overflow-y-auto">
              {room.players.map((p) => (
                <li
                  key={p.playerId}
                  className="flex items-center justify-between rounded-[5px] px-2 py-1 font-cartoon text-[11px] font-bold text-white"
                  style={{
                    backgroundColor:
                      p.playerId === selfPlayerId
                        ? 'rgba(255, 209, 71, 0.16)'
                        : 'rgba(11, 13, 24, 0.35)',
                  }}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {p.isOwner && (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="#FFD147"
                        aria-label="Owner"
                      >
                        <path d="M3 18H21L19 7L14 12L12 5L10 12L5 7L3 18Z" />
                      </svg>
                    )}
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span
                    className="ml-2 text-[10px]"
                    style={{ color: p.alive ? '#4ADE80' : '#F87171' }}
                  >
                    {p.alive ? `${p.hp} HP` : 'KO'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Owner-only REMOVE NPCS Control */}
        {isOwner && (
          <button
            type="button"
            disabled={room.npcsRemoved || removingNpcs}
            onClick={onRemoveNpcs}
            className="rounded-[7px] px-3 py-1.5 font-cartoon text-[11.5px] font-bold italic uppercase tracking-wide text-white transition-transform active:scale-95 disabled:opacity-60 cursor-pointer"
            style={{
              backgroundColor: room.npcsRemoved ? '#2B3054' : '#B91C3C',
              border: '2px solid #0B0D18',
              boxShadow: '2.5px 3px 0 #0B0D18',
              textShadow: '0 1px 0 #0B0D18',
            }}
          >
            {room.npcsRemoved
              ? 'NPCs Removed'
              : removingNpcs
                ? 'Removing...'
                : 'Remove NPCs'}
          </button>
        )}

        {/* Server Code + Player Count + Copy + Player List + Leave */}
        <div
          className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5"
          style={{
            backgroundColor: '#232856',
            backgroundImage: PURPLE_DOT_PATTERN,
            backgroundSize: '10px 10px',
            backgroundPosition: '0 0, 5px 5px',
            border: '2.5px solid #0B0D18',
            boxShadow: '3px 4px 0 #0B0D18',
          }}
        >
          {isOwner && (
            <svg
              width={isPc ? '16' : '13'}
              height={isPc ? '16' : '13'}
              viewBox="0 0 24 24"
              fill="#FFD147"
              aria-label="Server Owner"
            >
              <title>Server Owner</title>
              <path d="M3 18H21L19 7L14 12L12 5L10 12L5 7L3 18Z" />
            </svg>
          )}

          <button
            type="button"
            onClick={handleCopyCode}
            title="Copy server code"
            className="flex items-center gap-1 rounded-[5px] px-2 py-0.5 font-cartoon font-extrabold italic uppercase tracking-wider text-[#FFD147] hover:bg-white/10 cursor-pointer"
            style={{
              fontSize: isPc ? '13px' : '11px',
              textShadow: '0 1px 0 #0B0D18',
            }}
          >
            <span>SERVER: {room.code}</span>
            <span className="text-[10px] text-sky-300">
              {copied ? 'COPIED' : 'COPY'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            aria-expanded={listOpen}
            className="rounded-[5px] px-2 py-0.5 font-cartoon font-bold text-white hover:bg-white/10 cursor-pointer"
            style={{
              backgroundColor: 'rgba(11, 13, 24, 0.45)',
              fontSize: isPc ? '12px' : '10.5px',
            }}
          >
            {room.players.length}/{room.maxPlayers}
          </button>

          <button
            type="button"
            onClick={onLeaveServer}
            title="Leave Server"
            className="rounded-[5px] px-2 py-0.5 font-cartoon font-bold italic uppercase text-white transition-transform active:scale-95 cursor-pointer"
            style={{
              backgroundColor: '#562944',
              border: '1.5px solid #0B0D18',
              fontSize: isPc ? '11px' : '9.5px',
            }}
          >
            Leave
          </button>
        </div>
      </div>
    </>
  );
});
