import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type {
  AbilityVfxPacket,
  CombatCrowdControlKind,
  CombatCrowdControlPacket,
  CombatEffectEvent,
  CombatHealRequest,
  CombatHitRequest,
  CombatNpcDamageRequest,
  CombatVitalsEvent,
  GenericAckResult,
  PlayerMotionPacket,
  PlayerPublicInfo,
  RemotePlayerStateUpdate,
  RemoteShieldKind,
  RoomAckResult,
  RoomSnapshot,
  VampireAbsorbEvent,
  VampireAbsorbRequest,
} from './src/game/multiplayerTypes';
import type { MapId } from './src/game/maps';

const MAX_ROOM_PLAYERS = 8;
const ROOM_CODE_REGEX = /^[A-Z0-9]{6}$/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, 'dist');
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;
const MAX_SESSIONS = 500;
const MAX_COINS = 1_000_000;
const MAX_STAMINA = 100;
const STAMINA_REGEN_DELAY_SEC = 1.0;

const CHARACTER_MAX_HP: Record<string, number> = {
  'scarlet-witch': 250,
  'phoenix-force': 250,
  'emma-frost': 250,
  hela: 250,
  magneto: 260,
  quicksilver: 240,
  'doctor-strange': 250,
  vision: 260,
  'agatha-harkness': 250,
  'invisible-woman': 250,
  vampire: 250,
  'captain-america': 260,
  thor: 270,
  'silver-surfer': 260,
  storm: 240,
};

const CHARACTER_SKIN_IDS: Record<string, ReadonlySet<string>> = {
  'scarlet-witch': new Set(['scarlet-default', 'supreme-sorceress', 'wanda-zombie']),
  'phoenix-force': new Set(['phoenix-default', 'dark-phoenix', 'white-phoenix']),
  'emma-frost': new Set(['emma-default', 'white-queen']),
  hela: new Set(['hela-default', 'white-hela']),
  magneto: new Set(),
  quicksilver: new Set(['quicksilver-default', 'speed']),
  'doctor-strange': new Set(['strange-default', 'ancient-one']),
  vision: new Set(),
  'agatha-harkness': new Set(),
  'invisible-woman': new Set(),
  vampire: new Set(),
  'captain-america': new Set(),
  thor: new Set(),
  'silver-surfer': new Set(),
  storm: new Set(),
};

const ALL_VALID_SKIN_IDS = new Set<string>([
  'scarlet-default',
  'supreme-sorceress',
  'wanda-zombie',
  'phoenix-default',
  'dark-phoenix',
  'white-phoenix',
  'emma-default',
  'white-queen',
  'hela-default',
  'white-hela',
  'quicksilver-default',
  'speed',
  'strange-default',
  'ancient-one',
]);

const SKIN_PRICES: Record<string, number> = {
  'dark-phoenix': 100,
};

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ACTIVE_ROOMS = 300;
const WORLD_POS_BOUND = 220;
const WORLD_VEL_BOUND = 110;
const VALID_SHIELD_KINDS = new Set<string>([
  'auto-shield',
  'agatha-auto-shield',
  'diamond-form',
  'mystic-shield',
  'forcefield-shield',
  'shield-defense',
  'agatha-shield',
  'magneto-shield',
  'silver-absorb',
]);

const SPAWN_PROTECTION_MS = 2800;
const VAMPIRE_STOLEN_DURATION_MS = 40_000;

const SHIELD_CAPACITIES: Record<string, number> = {
  'auto-shield': 100,
  'agatha-auto-shield': 100,
  'diamond-form': 150,
  'mystic-shield': 120,
  'forcefield-shield': 200,
  'shield-defense': 150,
  'agatha-shield': 9999,
  'magneto-shield': 9999,
  'silver-absorb': 9999,
};

const SHIELD_DURATIONS_MS: Record<string, number> = {
  'auto-shield': 10_000,
  'agatha-auto-shield': 10_000,
  'diamond-form': 15_000,
  'mystic-shield': 10_000,
  'forcefield-shield': 10_000,
  'shield-defense': 30_000,
  'agatha-shield': 6_500,
  'magneto-shield': 120_000,
  'silver-absorb': 120_000,
};

const SERVER_STEALABLE_POOLS: Record<string, readonly string[]> = {
  'scarlet-witch': ['chaos-bolt', 'darkhold', 'chaos-implosion'],
  'scarlet-witch:supreme-sorceress': ['supreme-ritual', 'chaos-drain', 'chaos-implosion'],
  'scarlet-witch:wanda-zombie': ['chaos-bolt', 'zombie-beam', 'zombie-stone-explosion'],
  'agatha-harkness': ['agatha-bolt', 'agatha-darkhold', 'agatha-shield'],
  'phoenix-force': ['phoenix-wave', 'phoenix-fireballs', 'pain-infliction'],
  'emma-frost': ['mental-attack', 'diamond-form', 'telepathic-wave'],
  'emma-frost:white-queen': ['mind-control', 'diamond-form', 'telepathic-wave'],
  hela: ['sword-summon', 'green-explosion', 'ground-sword'],
  magneto: ['metal-projectile', 'magnetic-meteor', 'metal-tornado'],
  quicksilver: ['rapid-punch-combo', 'wind-tornado', 'time-stop'],
  'quicksilver:speed': ['speed-blitz', 'wind-tornado', 'time-stop'],
  'doctor-strange': ['purgatory-grasp', 'mystic-clones', 'eldritch-discs'],
  'doctor-strange:ancient-one': ['astral-extraction', 'mystic-clones', 'eldritch-discs'],
  vision: ['mind-stone-laser', 'mind-stone-projectile', 'head-grip'],
  'invisible-woman': ['invisibility', 'forcefield-shield', 'forcefield-barrier'],
  vampire: ['vampire-bolt', 'ground-stomp'],
  'captain-america': ['shield-throw', 'shield-combo', 'shield-charge'],
  thor: ['mjolnir-combo', 'mjolnir-throw', 'lightning-storm-beam'],
  'silver-surfer': ['damage-absorption', 'cosmic-blast', 'dual-cosmic-beam'],
  storm: ['storm-tornado', 'ice-spear', 'wind-blast'],
};

function getServerStealablePool(characterId: string, skinId: string | null): readonly string[] {
  if (skinId) {
    const bySkin = SERVER_STEALABLE_POOLS[`${characterId}:${skinId}`];
    if (bySkin) return bySkin;
  }
  return SERVER_STEALABLE_POOLS[characterId] ?? SERVER_STEALABLE_POOLS['scarlet-witch'];
}

const VALID_VFX_KINDS = new Set<string>([
  'cast',
  'bolt',
  'explosion',
  'shockwave',
  'teleport',
  'lightning',
  'respawn',
  'death',
  'projectile',
  'beam',
  'tornado',
  'meteor',
  'slash',
  'shield',
  'aura',
  'slam',
  'ritual',
  'grab',
  'clones',
  'stomp',
  'freeze',
  'disc',
  'spear',
  'wind',
  'vampire-absorb',
]);

const VALID_CC_KINDS = new Set<string>([
  'external-control',
  'external-pose',
  'paralyze',
  'mind-control-paralyze',
  'pain',
  'clones',
  'forcefield',
  'clear',
]);

interface ServerPlayer {
  playerId: string;
  reconnectToken: string;
  socketId: string;
  name: string;
  characterId: string;
  skinId: string | null;
  hp: number;
  maxHp: number;
  alive: boolean;
  spawnProtected: boolean;
  spawnProtectedUntilMs: number;
  invulnerable: boolean;
  shieldKind: RemoteShieldKind;
  shieldRemaining: number;
  shieldExpiresAtMs: number;
  silverAbsorbEnergy: number;
  stolenAbilityId: string | null;
  stolenExpiresAtMs: number;
  pendingAbsorbTargetId: string | null;
  activeCcTargets: Set<string>;
  lastSeq: number;
  serverSeq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  lastStateAtMs: number;
  lastVfxAtMs: number;
  lastCombatHitAtMs: number;
  lastHealAtMs: number;
  lastAttackerId: string | null;
  lastAttackedAtMs: number;
  lastMotion: PlayerMotionPacket;
}

interface ServerRoom {
  code: string;
  mapId: MapId;
  maxPlayers: number;
  ownerPlayerId: string;
  npcsRemoved: boolean;
  createdAtMs: number;
  players: Map<string, ServerPlayer>;
}

const rooms = new Map<string, ServerRoom>();
const socketActionWindows = new Map<string, { windowStartMs: number; count: number }>();

function checkSocketActionRate(socketId: string, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = socketActionWindows.get(socketId);
  if (!entry || now - entry.windowStartMs >= windowMs) {
    socketActionWindows.set(socketId, { windowStartMs: now, count: 1 });
    return true;
  }
  if (entry.count >= maxPerWindow) {
    return false;
  }
  entry.count += 1;
  return true;
}

function sanitizePlayerName(raw: unknown, fallbackIndex: number): string {
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 18);
    if (cleaned.length >= 2) return cleaned;
  }
  return `Hero ${fallbackIndex}`;
}

function resolveValidCharacterId(raw: unknown): string {
  if (
    typeof raw === 'string' &&
    Object.prototype.hasOwnProperty.call(CHARACTER_MAX_HP, raw)
  ) {
    return raw;
  }
  return 'scarlet-witch';
}

function resolveValidSkinId(characterId: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (CHARACTER_SKIN_IDS[characterId]?.has(raw)) {
    return raw;
  }
  return null;
}

function resolveValidMapId(raw: unknown): MapId {
  return raw === 'test' ? 'test' : 'existing';
}

function generateUniqueRoomCode(): string | null {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  return null;
}

function buildDefaultMotion(characterId: string, skinId: string | null): PlayerMotionPacket {
  const maxHp = CHARACTER_MAX_HP[characterId] ?? 250;
  return {
    characterId,
    skinId,
    x: 0,
    y: 0.4,
    z: 0,
    yaw: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    localForward: 0,
    localRight: 0,
    turnVelocity: 0,
    grounded: true,
    justJumped: false,
    landImpactSpeed: 0,
    sprinting: false,
    flying: false,
    superSpeed: false,
    hp: maxHp,
    maxHp,
    dead: false,
    ragdoll: false,
    spawnProtected: true,
    invulnerable: false,
    shieldKind: null,
    invisible: false,
    darkholdOpen: false,
    crownMode: false,
    wingsVisible: false,
    swordHeld: false,
    ritualPhase: 'idle',
    sustainedFlags: 0,
    stolenAbilityId: null,
    targetId: null,
    seq: 0,
    clientTimeMs: Date.now(),
  };
}

function wrapYawRadians(yaw: number): number {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

function sanitizeMotionPacket(
  prev: ServerPlayer,
  raw: unknown,
): PlayerMotionPacket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;

  const nums = [p.x, p.y, p.z, p.yaw, p.vx, p.vy, p.vz, p.hp];
  for (const n of nums) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  }

  const characterId = resolveValidCharacterId(p.characterId);
  const skinId = resolveValidSkinId(characterId, p.skinId);
  const maxHp = CHARACTER_MAX_HP[characterId] ?? 250;

  const x = clampFinite(p.x, -WORLD_POS_BOUND, WORLD_POS_BOUND, prev.x);
  const y = clampFinite(p.y, -20, 180, prev.y);
  const z = clampFinite(p.z, -WORLD_POS_BOUND, WORLD_POS_BOUND, prev.z);
  const yaw = wrapYawRadians(p.yaw as number);
  const vx = clampFinite(p.vx, -WORLD_VEL_BOUND, WORLD_VEL_BOUND, 0);
  const vy = clampFinite(p.vy, -WORLD_VEL_BOUND, WORLD_VEL_BOUND, 0);
  const vz = clampFinite(p.vz, -WORLD_VEL_BOUND, WORLD_VEL_BOUND, 0);
  const localForward = clampFinite(p.localForward, -3.5, 3.5, 0);
  const localRight = clampFinite(p.localRight, -3.5, 3.5, 0);
  const turnVelocity = clampFinite(p.turnVelocity, -35, 35, 0);
  const landImpactSpeed = clampFinite(p.landImpactSpeed, 0, 120, 0);
  const hp = Math.round(clampFinite(p.hp, 0, maxHp, prev.hp));
  const dead = Boolean(p.dead) || hp <= 0;
  const shieldKind: RemoteShieldKind =
    typeof p.shieldKind === 'string' && VALID_SHIELD_KINDS.has(p.shieldKind)
      ? (p.shieldKind as RemoteShieldKind)
      : null;

  const ritualPhase =
    typeof p.ritualPhase === 'string' && p.ritualPhase.length <= 24
      ? p.ritualPhase
      : 'idle';

  const targetId =
    typeof p.targetId === 'string' && p.targetId.length <= 64 ? p.targetId : null;

  return {
    characterId,
    skinId,
    x,
    y,
    z,
    yaw,
    vx,
    vy,
    vz,
    localForward,
    localRight,
    turnVelocity,
    grounded: Boolean(p.grounded),
    justJumped: Boolean(p.justJumped),
    landImpactSpeed,
    sprinting: Boolean(p.sprinting),
    flying: Boolean(p.flying),
    superSpeed: Boolean(p.superSpeed),
    hp,
    maxHp,
    dead,
    ragdoll: Boolean(p.ragdoll),
    spawnProtected: Boolean(p.spawnProtected),
    invulnerable: Boolean(p.invulnerable),
    shieldKind,
    invisible: Boolean(p.invisible),
    darkholdOpen: Boolean(p.darkholdOpen),
    crownMode: Boolean(p.crownMode),
    wingsVisible: Boolean(p.wingsVisible),
    swordHeld: Boolean(p.swordHeld),
    ritualPhase,
    sustainedFlags:
      typeof p.sustainedFlags === 'number' && Number.isFinite(p.sustainedFlags)
        ? (p.sustainedFlags & 0xffff)
        : 0,
    stolenAbilityId: prev.stolenAbilityId,
    targetId,
    seq:
      typeof p.seq === 'number' && Number.isFinite(p.seq)
        ? Math.max(0, Math.floor(p.seq))
        : prev.lastMotion.seq + 1,
    clientTimeMs:
      typeof p.clientTimeMs === 'number' && Number.isFinite(p.clientTimeMs)
        ? p.clientTimeMs
        : Date.now(),
  };
}

function buildVitalsEvent(player: ServerPlayer, nowMs = Date.now()): CombatVitalsEvent {
  return {
    playerId: player.playerId,
    hp: Math.round(player.hp * 10) / 10,
    maxHp: player.maxHp,
    alive: player.alive,
    spawnProtected: nowMs < player.spawnProtectedUntilMs,
    shieldKind: player.shieldKind,
    shieldRemaining: Math.round(player.shieldRemaining * 10) / 10,
    silverAbsorbEnergy:
      player.characterId === 'silver-surfer' || player.stolenAbilityId === 'damage-absorption'
        ? Math.round(player.silverAbsorbEnergy)
        : undefined,
    lastAttackerId: player.lastAttackerId,
    serverTimeMs: nowMs,
  };
}

function applyServerDamage(
  io: SocketIOServer,
  room: ServerRoom,
  target: ServerPlayer,
  rawDamage: number,
  attacker: ServerPlayer | null,
  isBeam: boolean,
  nowMs: number,
): { appliedHpDamage: number; shieldBroken: boolean; killed: boolean } {
  if (!target.alive || rawDamage <= 0) {
    return { appliedHpDamage: 0, shieldBroken: false, killed: false };
  }
  if (nowMs < target.spawnProtectedUntilMs || target.invulnerable) {
    return { appliedHpDamage: 0, shieldBroken: false, killed: false };
  }
  if (target.shieldKind === 'magneto-shield') {
    return { appliedHpDamage: 0, shieldBroken: false, killed: false };
  }

  let remainingDamage = rawDamage;
  let shieldBroken = false;

  if (
    target.shieldKind &&
    target.shieldKind !== 'agatha-shield' &&
    target.shieldKind !== 'silver-absorb' &&
    target.shieldRemaining > 0
  ) {
    const absorbed = Math.min(target.shieldRemaining, remainingDamage);
    target.shieldRemaining = Math.max(0, target.shieldRemaining - absorbed);
    remainingDamage -= absorbed;
    if (target.shieldRemaining <= 0) {
      target.shieldKind = null;
      target.shieldExpiresAtMs = 0;
      shieldBroken = true;
    }
  }

  if (
    remainingDamage > 0 &&
    target.shieldKind === 'silver-absorb' &&
    target.silverAbsorbEnergy < 80
  ) {
    remainingDamage *= 0.5;
    target.silverAbsorbEnergy = Math.min(
      100,
      target.silverAbsorbEnergy + Math.max(18, Math.round(rawDamage * 0.75)),
    );
  }

  if (remainingDamage > 0) {
    target.hp = Math.max(0, target.hp - remainingDamage);
  }

  let killed = false;
  if (target.hp <= 0 && target.alive) {
    target.hp = 0;
    target.alive = false;
    target.shieldKind = null;
    target.shieldRemaining = 0;
    target.stolenAbilityId = null;
    target.stolenExpiresAtMs = 0;
    target.lastMotion = {
      ...target.lastMotion,
      hp: 0,
      dead: true,
      ragdoll: true,
      shieldKind: null,
      stolenAbilityId: null,
    };
    killed = true;
    clearCasterCrowdControls(io, room, target);

    const killerId = attacker?.playerId ?? target.lastAttackerId;
    if (killerId && killerId !== target.playerId) {
      const killer = room.players.get(killerId);
      if (killer) {
        io.to(killer.socketId).emit('combat:elimination', {
          victimPlayerId: target.playerId,
          victimName: target.name,
          rewardCoins: 25,
        });
      }
    }
    target.lastAttackerId = null;
  } else {
    target.lastMotion = {
      ...target.lastMotion,
      hp: target.hp,
      shieldKind: target.shieldKind,
    };
  }

  io.to(room.code).emit('combat:vitals', buildVitalsEvent(target, nowMs));
  if (killed || shieldBroken || isBeam) {
    if (killed) {
      io.to(room.code).emit('room:update', buildRoomSnapshot(room));
    }
  }

  return {
    appliedHpDamage: remainingDamage,
    shieldBroken,
    killed,
  };
}

function clearCasterCrowdControls(
  io: SocketIOServer,
  room: ServerRoom,
  caster: ServerPlayer,
): void {
  if (caster.activeCcTargets.size === 0) return;
  const nowMs = Date.now();
  for (const targetPlayerId of caster.activeCcTargets) {
    const clearPacket: CombatCrowdControlPacket = {
      attackerPlayerId: caster.playerId,
      targetPlayerId,
      kind: 'clear',
      active: false,
      serverTimeMs: nowMs,
    };
    io.to(room.code).emit('combat:cc', clearPacket);
  }
  caster.activeCcTargets.clear();
}

function buildRoomSnapshot(room: ServerRoom): RoomSnapshot {
  const players: PlayerPublicInfo[] = [];
  for (const player of room.players.values()) {
    players.push({
      playerId: player.playerId,
      name: player.name,
      characterId: player.characterId,
      skinId: player.skinId,
      isOwner: player.playerId === room.ownerPlayerId,
      hp: Math.round(player.hp),
      maxHp: player.maxHp,
      alive: player.alive,
      stolenAbilityId: player.stolenAbilityId,
    });
  }
  return {
    code: room.code,
    mapId: room.mapId,
    maxPlayers: room.maxPlayers,
    ownerPlayerId: room.ownerPlayerId,
    npcsRemoved: room.npcsRemoved,
    players,
  };
}

function removePlayerFromCurrentRoom(
  io: SocketIOServer,
  socket: Socket,
): void {
  const roomCode = socket.data.roomCode as string | undefined;
  const playerId = socket.data.playerId as string | undefined;
  if (!roomCode || !playerId) return;

  socket.data.roomCode = undefined;
  socket.data.playerId = undefined;
  void socket.leave(roomCode);

  const room = rooms.get(roomCode);
  if (!room) return;

  const departing = room.players.get(playerId);
  if (!departing) return;
  clearCasterCrowdControls(io, room, departing);
  room.players.delete(playerId);

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  let newOwnerPlayerId: string | null = null;
  if (room.ownerPlayerId === playerId) {
    const nextOwner = room.players.values().next().value as ServerPlayer | undefined;
    if (nextOwner) {
      room.ownerPlayerId = nextOwner.playerId;
      newOwnerPlayerId = nextOwner.playerId;
    }
  }

  const snapshot = buildRoomSnapshot(room);
  io.to(roomCode).emit('room:playerLeft', {
    playerId,
    playerName: departing.name,
    newOwnerPlayerId,
    room: snapshot,
  });
  io.to(roomCode).emit('room:update', snapshot);
}

function parseAllowedOrigins(): string[] | true {
  return true;
}

export interface ValidatedGameState {
  selectedCharacterId: string;
  selectedSkinsByChar: Record<string, string>;
  unlockedSkins: string[];
  coins: number;
  stamina: number;
  maxStamina: number;
  staminaRegenDelayRemaining: number;
  sprintEnabled: boolean;
  flightEnabled: boolean;
  hp: number;
  maxHp: number;
  killStreak: number;
  activeAbilityLocked: boolean;
  invisibilityActive: boolean;
  forcefieldActive: boolean;
  updatedAtMs: number;
}

interface SessionRecord {
  sessionId: string;
  state: ValidatedGameState;
  lastTouchedMs: number;
}

const sessionStore = new Map<string, SessionRecord>();
const ttsAudioCache = new Map<string, Buffer>();
const ttsInFlight = new Map<string, Promise<Buffer | null>>();
const CHARACTER_NAME_PATTERN = /^[a-zA-Z0-9 .'\-&]{1,60}$/;
async function synthesizeCharacterNameWav(_name: string): Promise<Buffer | null> {
  return null;
}

function createDefaultState(): ValidatedGameState {
  return {
    selectedCharacterId: 'scarlet-witch',
    selectedSkinsByChar: {},
    unlockedSkins: [],
    coins: 0,
    stamina: MAX_STAMINA,
    maxStamina: MAX_STAMINA,
    staminaRegenDelayRemaining: 0,
    sprintEnabled: false,
    flightEnabled: false,
    hp: 250,
    maxHp: 250,
    killStreak: 0,
    activeAbilityLocked: false,
    invisibilityActive: false,
    forcefieldActive: false,
    updatedAtMs: Date.now(),
  };
}

function resolveSessionId(req: Request): string {
  const headerVal = req.header('x-session-id');
  if (headerVal && SESSION_ID_PATTERN.test(headerVal)) {
    return headerVal;
  }
  return crypto.randomUUID();
}

function getOrCreateSession(sessionId: string): SessionRecord {
  const existing = sessionStore.get(sessionId);
  if (existing) {
    existing.lastTouchedMs = Date.now();
    return existing;
  }
  if (sessionStore.size >= MAX_SESSIONS) {
    const oldestKey = sessionStore.keys().next().value;
    if (oldestKey) {
      sessionStore.delete(oldestKey);
    }
  }
  const created: SessionRecord = {
    sessionId,
    state: createDefaultState(),
    lastTouchedMs: Date.now(),
  };
  sessionStore.set(sessionId, created);
  return created;
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function validateAndMergeState(
  prev: ValidatedGameState,
  payload: unknown,
): ValidatedGameState {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return prev;
  }
  const input = payload as Record<string, unknown>;

  const nextCharId =
    typeof input.selectedCharacterId === 'string' &&
    Object.prototype.hasOwnProperty.call(CHARACTER_MAX_HP, input.selectedCharacterId)
      ? input.selectedCharacterId
      : prev.selectedCharacterId;

  const maxHp = CHARACTER_MAX_HP[nextCharId] ?? 250;

  const nextUnlockedSet = new Set<string>(prev.unlockedSkins);
  if (Array.isArray(input.unlockedSkins)) {
    for (const skin of input.unlockedSkins) {
      if (typeof skin === 'string' && ALL_VALID_SKIN_IDS.has(skin)) {
        nextUnlockedSet.add(skin);
      }
    }
  }

  let nextCoins = prev.coins;
  if (typeof input.coins === 'number' && Number.isFinite(input.coins)) {
    const requestedCoins = Math.floor(clampFinite(input.coins, 0, MAX_COINS, prev.coins));
    // Guard against abrupt unearned coin inflation while allowing legitimate kill payouts & purchases
    const delta = requestedCoins - prev.coins;
    if (delta <= 1000) {
      nextCoins = requestedCoins;
    } else if (prev.coins === 0 && requestedCoins <= 5000) {
      // Initial client localStorage restore on fresh session boot
      nextCoins = requestedCoins;
    }
  }

  // Enforce skin purchase deduction if a priced skin was just unlocked
  if (typeof input.purchaseSkinId === 'string' && ALL_VALID_SKIN_IDS.has(input.purchaseSkinId)) {
    const price = SKIN_PRICES[input.purchaseSkinId] ?? 0;
    if (!prev.unlockedSkins.includes(input.purchaseSkinId) && prev.coins >= price) {
      nextCoins = Math.max(0, prev.coins - price);
      nextUnlockedSet.add(input.purchaseSkinId);
    }
  }

  const nextSkinsByChar: Record<string, string> = { ...prev.selectedSkinsByChar };
  if (
    input.selectedSkinsByChar &&
    typeof input.selectedSkinsByChar === 'object' &&
    !Array.isArray(input.selectedSkinsByChar)
  ) {
    for (const [charId, skinId] of Object.entries(
      input.selectedSkinsByChar as Record<string, unknown>,
    )) {
      if (
        typeof skinId === 'string' &&
        CHARACTER_SKIN_IDS[charId]?.has(skinId)
      ) {
        const price = SKIN_PRICES[skinId] ?? 0;
        if (price === 0 || nextUnlockedSet.has(skinId)) {
          nextSkinsByChar[charId] = skinId;
        }
      }
    }
  }

  const nextStamina = clampFinite(input.stamina, 0, MAX_STAMINA, prev.stamina);
  const nextRegenDelay = clampFinite(
    input.staminaRegenDelayRemaining,
    0,
    STAMINA_REGEN_DELAY_SEC,
    prev.staminaRegenDelayRemaining,
  );
  // Stamina 0 forces sprint disabled
  const requestedSprint =
    typeof input.sprintEnabled === 'boolean' ? input.sprintEnabled : prev.sprintEnabled;
  const nextSprint = nextStamina > 0 ? requestedSprint : false;

  const nextFlight =
    typeof input.flightEnabled === 'boolean' ? input.flightEnabled : prev.flightEnabled;

  // Enforce Magneto flight rule: offensive ground abilities cannot coexist with flight shield
  const activeAbilityLocked =
    nextCharId === 'magneto'
      ? nextFlight
      : typeof input.activeAbilityLocked === 'boolean'
        ? input.activeAbilityLocked
        : prev.activeAbilityLocked;

  const nextHp = Math.round(clampFinite(input.hp, 0, maxHp, prev.hp));
  const nextStreak = Math.floor(clampFinite(input.killStreak, 0, 9999, prev.killStreak));

  // Enforce Invisible Woman rules: Invisibility works grounded or flying and cannot coexist with active Forcefield abilities
  const requestedForcefield =
    nextCharId === 'invisible-woman'
      ? typeof input.forcefieldActive === 'boolean'
        ? input.forcefieldActive
        : prev.forcefieldActive
      : false;
  const requestedInvisibility =
    nextCharId === 'invisible-woman' && !requestedForcefield
      ? typeof input.invisibilityActive === 'boolean'
        ? input.invisibilityActive
        : prev.invisibilityActive
      : false;

  return {
    selectedCharacterId: nextCharId,
    selectedSkinsByChar: nextSkinsByChar,
    unlockedSkins: Array.from(nextUnlockedSet),
    coins: nextCoins,
    stamina: Number(nextStamina.toFixed(2)),
    maxStamina: MAX_STAMINA,
    staminaRegenDelayRemaining: Number(nextRegenDelay.toFixed(3)),
    sprintEnabled: nextSprint,
    flightEnabled: nextFlight,
    hp: nextHp,
    maxHp,
    killStreak: nextStreak,
    activeAbilityLocked,
    invisibilityActive: requestedInvisibility,
    forcefieldActive: requestedForcefield,
    updatedAtMs: Date.now(),
  };
}

function attachMultiplayerSocketServer(httpServer: http.Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingInterval: 15000,
    pingTimeout: 10000,
    maxHttpBufferSize: 32 * 1024,
    cors: {
      origin: parseAllowedOrigins(),
      methods: ['GET', 'POST'],
      credentials: false,
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on(
      'room:create',
      (
        payload: {
          playerName?: string;
          characterId?: string;
          skinId?: string | null;
          mapId?: MapId;
        },
        ack?: (res: RoomAckResult) => void,
      ) => {
        if (!checkSocketActionRate(socket.id, 10, 10_000)) {
          ack?.({
            ok: false,
            code: 'RATE_LIMITED',
            message: 'Too many requests. Wait a moment and try again.',
          });
          return;
        }
        if (rooms.size >= MAX_ACTIVE_ROOMS) {
          ack?.({
            ok: false,
            code: 'SERVER_ERROR',
            message: 'Server room capacity reached. Try again shortly.',
          });
          return;
        }

        removePlayerFromCurrentRoom(io, socket);

        const code = generateUniqueRoomCode();
        if (!code) {
          ack?.({
            ok: false,
            code: 'SERVER_ERROR',
            message: 'Could not allocate a unique room code.',
          });
          return;
        }

        const playerId = crypto.randomUUID();
        const reconnectToken = crypto.randomBytes(24).toString('hex');
        const characterId = resolveValidCharacterId(payload?.characterId);
        const skinId = resolveValidSkinId(characterId, payload?.skinId);
        const maxHp = CHARACTER_MAX_HP[characterId] ?? 250;
        const mapId = resolveValidMapId(payload?.mapId);

        const now = Date.now();
        const player: ServerPlayer = {
          playerId,
          reconnectToken,
          socketId: socket.id,
          name: sanitizePlayerName(payload?.playerName, 1),
          characterId,
          skinId,
          hp: maxHp,
          maxHp,
          alive: true,
          spawnProtected: true,
          spawnProtectedUntilMs: now + SPAWN_PROTECTION_MS,
          invulnerable: false,
          shieldKind: null,
          shieldRemaining: 0,
          shieldExpiresAtMs: 0,
          silverAbsorbEnergy: 0,
          stolenAbilityId: null,
          stolenExpiresAtMs: 0,
          pendingAbsorbTargetId: null,
          activeCcTargets: new Set<string>(),
          lastSeq: 0,
          serverSeq: 0,
          x: 0,
          y: 0.4,
          z: 0,
          yaw: 0,
          lastStateAtMs: 0,
          lastVfxAtMs: 0,
          lastCombatHitAtMs: 0,
          lastHealAtMs: 0,
          lastAttackerId: null,
          lastAttackedAtMs: 0,
          lastMotion: buildDefaultMotion(characterId, skinId),
        };

        const room: ServerRoom = {
          code,
          mapId,
          maxPlayers: MAX_ROOM_PLAYERS,
          ownerPlayerId: playerId,
          npcsRemoved: false,
          createdAtMs: now,
          players: new Map([[playerId, player]]),
        };
        rooms.set(code, room);

        socket.data.roomCode = code;
        socket.data.playerId = playerId;
        void socket.join(code);

        ack?.({
          ok: true,
          playerId,
          reconnectToken,
          room: buildRoomSnapshot(room),
        });
        socket.emit('combat:vitals', buildVitalsEvent(player, now));
      },
    );

    socket.on(
      'room:join',
      (
        payload: {
          code?: string;
          playerName?: string;
          characterId?: string;
          skinId?: string | null;
        },
        ack?: (res: RoomAckResult) => void,
      ) => {
        if (!checkSocketActionRate(socket.id, 15, 10_000)) {
          ack?.({
            ok: false,
            code: 'RATE_LIMITED',
            message: 'Too many join attempts. Please wait a second.',
          });
          return;
        }

        const normalizedCode =
          typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
        if (!ROOM_CODE_REGEX.test(normalizedCode)) {
          ack?.({
            ok: false,
            code: 'INVALID_CODE',
            message: 'Enter a valid 6-character server code.',
          });
          return;
        }

        const room = rooms.get(normalizedCode);
        if (!room) {
          ack?.({
            ok: false,
            code: 'ROOM_NOT_FOUND',
            message: 'Server code not found or no longer active.',
          });
          return;
        }

        const existingRoomCode = socket.data.roomCode as string | undefined;
        if (existingRoomCode) {
          removePlayerFromCurrentRoom(io, socket);
        }

        if (room.players.size >= room.maxPlayers) {
          ack?.({
            ok: false,
            code: 'ROOM_FULL',
            message: `This server is full (${room.maxPlayers}/${room.maxPlayers} players).`,
          });
          return;
        }

        const playerId = crypto.randomUUID();
        const reconnectToken = crypto.randomBytes(24).toString('hex');
        const characterId = resolveValidCharacterId(payload?.characterId);
        const skinId = resolveValidSkinId(characterId, payload?.skinId);
        const maxHp = CHARACTER_MAX_HP[characterId] ?? 250;
        const now = Date.now();

        const player: ServerPlayer = {
          playerId,
          reconnectToken,
          socketId: socket.id,
          name: sanitizePlayerName(payload?.playerName, room.players.size + 1),
          characterId,
          skinId,
          hp: maxHp,
          maxHp,
          alive: true,
          spawnProtected: true,
          spawnProtectedUntilMs: now + SPAWN_PROTECTION_MS,
          invulnerable: false,
          shieldKind: null,
          shieldRemaining: 0,
          shieldExpiresAtMs: 0,
          silverAbsorbEnergy: 0,
          stolenAbilityId: null,
          stolenExpiresAtMs: 0,
          pendingAbsorbTargetId: null,
          activeCcTargets: new Set<string>(),
          lastSeq: 0,
          serverSeq: 0,
          x: 0,
          y: 0.4,
          z: 0,
          yaw: 0,
          lastStateAtMs: 0,
          lastVfxAtMs: 0,
          lastCombatHitAtMs: 0,
          lastHealAtMs: 0,
          lastAttackerId: null,
          lastAttackedAtMs: 0,
          lastMotion: buildDefaultMotion(characterId, skinId),
        };
        room.players.set(playerId, player);

        socket.data.roomCode = room.code;
        socket.data.playerId = playerId;
        void socket.join(room.code);

        const snapshot = buildRoomSnapshot(room);
        ack?.({
          ok: true,
          playerId,
          reconnectToken,
          room: snapshot,
        });

        socket.to(room.code).emit('room:playerJoined', {
          playerId,
          playerName: player.name,
          room: snapshot,
        });
        io.to(room.code).emit('room:update', snapshot);
        socket.emit('combat:vitals', buildVitalsEvent(player, now));

        for (const existingPlayer of room.players.values()) {
          if (existingPlayer.playerId === playerId) continue;
          existingPlayer.serverSeq += 1;
          const stateMsg: RemotePlayerStateUpdate = {
            ...existingPlayer.lastMotion,
            justJumped: false,
            landImpactSpeed: 0,
            hp: existingPlayer.hp,
            maxHp: existingPlayer.maxHp,
            dead: !existingPlayer.alive,
            spawnProtected: now < existingPlayer.spawnProtectedUntilMs,
            shieldKind: existingPlayer.shieldKind,
            stolenAbilityId: existingPlayer.stolenAbilityId,
            seq: existingPlayer.serverSeq,
            playerId: existingPlayer.playerId,
            serverTimeMs: now,
          };
          socket.emit('player:state', stateMsg);
          socket.emit('combat:vitals', buildVitalsEvent(existingPlayer, now));
        }
      },
    );

    socket.on(
      'room:rejoin',
      (
        payload: { code?: string; playerId?: string; reconnectToken?: string },
        ack?: (res: RoomAckResult) => void,
      ) => {
        const normalizedCode =
          typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
        const playerId = typeof payload?.playerId === 'string' ? payload.playerId : '';
        const reconnectToken =
          typeof payload?.reconnectToken === 'string' ? payload.reconnectToken : '';
        if (!ROOM_CODE_REGEX.test(normalizedCode) || !playerId || !reconnectToken) {
          ack?.({
            ok: false,
            code: 'INVALID_CODE',
            message: 'Missing reconnect credentials.',
          });
          return;
        }
        const room = rooms.get(normalizedCode);
        const existing = room?.players.get(playerId);
        if (!room || !existing || existing.reconnectToken !== reconnectToken) {
          ack?.({
            ok: false,
            code: 'ROOM_NOT_FOUND',
            message: 'Session expired. Rejoin with the server code.',
          });
          return;
        }

        existing.socketId = socket.id;
        existing.lastSeq = 0;
        socket.data.roomCode = room.code;
        socket.data.playerId = existing.playerId;
        void socket.join(room.code);

        const now = Date.now();
        const snapshot = buildRoomSnapshot(room);
        ack?.({
          ok: true,
          playerId: existing.playerId,
          reconnectToken: existing.reconnectToken,
          room: snapshot,
        });
        socket.emit('combat:vitals', buildVitalsEvent(existing, now));
        for (const other of room.players.values()) {
          if (other.playerId === existing.playerId) continue;
          other.serverSeq += 1;
          socket.emit('player:state', {
            ...other.lastMotion,
            justJumped: false,
            landImpactSpeed: 0,
            hp: other.hp,
            maxHp: other.maxHp,
            dead: !other.alive,
            spawnProtected: now < other.spawnProtectedUntilMs,
            shieldKind: other.shieldKind,
            stolenAbilityId: other.stolenAbilityId,
            seq: other.serverSeq,
            playerId: other.playerId,
            serverTimeMs: now,
          });
          socket.emit('combat:vitals', buildVitalsEvent(other, now));
        }
      },
    );

    socket.on('room:leave', (ack?: (res: GenericAckResult) => void) => {
      removePlayerFromCurrentRoom(io, socket);
      ack?.({ ok: true });
    });

    socket.on('room:removeNpcs', (ack?: (res: GenericAckResult) => void) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) {
        ack?.({ ok: false, code: 'UNAUTHORIZED', message: 'Not in a server room.' });
        return;
      }
      const room = rooms.get(roomCode);
      if (!room) {
        ack?.({ ok: false, code: 'ROOM_NOT_FOUND', message: 'Room not found.' });
        return;
      }
      if (room.ownerPlayerId !== playerId) {
        ack?.({
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'Only the server owner can remove NPCs.',
        });
        return;
      }

      if (!room.npcsRemoved) {
        room.npcsRemoved = true;
      }
      const snapshot = buildRoomSnapshot(room);
      io.to(room.code).emit('room:npcsRemoved', {
        removed: true,
        byPlayerId: playerId,
        room: snapshot,
      });
      io.to(room.code).emit('room:update', snapshot);
      ack?.({ ok: true });
    });

    socket.on('player:state', (rawPacket: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player || player.socketId !== socket.id) return;

      const now = Date.now();
      const sanitized = sanitizeMotionPacket(player, rawPacket);
      if (!sanitized) return;

      const isUrgentEdge =
        Boolean(sanitized.justJumped) ||
        (sanitized.landImpactSpeed ?? 0) > 0 ||
        sanitized.grounded !== player.lastMotion.grounded ||
        sanitized.flying !== player.lastMotion.flying ||
        sanitized.sprinting !== player.lastMotion.sprinting ||
        sanitized.superSpeed !== player.lastMotion.superSpeed ||
        sanitized.dead !== player.lastMotion.dead ||
        sanitized.ragdoll !== player.lastMotion.ragdoll ||
        sanitized.shieldKind !== player.shieldKind;

      if (!isUrgentEdge && now - player.lastStateAtMs < 12) return;

      // Drop out-of-order stale packets while allowing respawn/remount/time-advance resets
      const clientAdvancedReset =
        sanitized.clientTimeMs > player.lastMotion.clientTimeMs + 1200;
      if (
        !clientAdvancedReset &&
        sanitized.seq > 2 &&
        player.lastSeq > 0 &&
        sanitized.seq <= player.lastSeq &&
        player.lastSeq - sanitized.seq < 1000
      ) {
        return;
      }
      player.lastSeq = sanitized.seq;

      const characterChanged =
        player.characterId !== sanitized.characterId ||
        player.skinId !== sanitized.skinId;

      if (characterChanged) {
        clearCasterCrowdControls(io, room, player);
        player.characterId = sanitized.characterId;
        player.skinId = sanitized.skinId;
        player.maxHp = sanitized.maxHp;
        player.hp = sanitized.maxHp;
        player.alive = true;
        player.spawnProtectedUntilMs = now + SPAWN_PROTECTION_MS;
        player.shieldKind = null;
        player.shieldRemaining = 0;
        player.shieldExpiresAtMs = 0;
        player.silverAbsorbEnergy = 0;
        player.stolenAbilityId = null;
        player.stolenExpiresAtMs = 0;
        player.pendingAbsorbTargetId = null;
        io.to(room.code).emit('combat:vitals', buildVitalsEvent(player, now));
      } else {
        // Server tracks shield activation/deactivation and enforces capacity
        if (sanitized.shieldKind !== player.shieldKind) {
          if (sanitized.shieldKind) {
            player.shieldKind = sanitized.shieldKind;
            player.shieldRemaining = SHIELD_CAPACITIES[sanitized.shieldKind] ?? 100;
            player.shieldExpiresAtMs =
              now + (SHIELD_DURATIONS_MS[sanitized.shieldKind] ?? 12_000);
            if (sanitized.shieldKind === 'silver-absorb') {
              player.silverAbsorbEnergy = 0;
            }
          } else {
            player.shieldKind = null;
            player.shieldRemaining = 0;
            player.shieldExpiresAtMs = 0;
            if (player.silverAbsorbEnergy > 0) {
              player.silverAbsorbEnergy = 0;
            }
          }
          io.to(room.code).emit('combat:vitals', buildVitalsEvent(player, now));
        } else if (
          player.shieldKind &&
          player.shieldExpiresAtMs > 0 &&
          now > player.shieldExpiresAtMs
        ) {
          player.shieldKind = null;
          player.shieldRemaining = 0;
          player.shieldExpiresAtMs = 0;
          io.to(room.code).emit('combat:vitals', buildVitalsEvent(player, now));
        }
      }

      if (player.stolenAbilityId && player.stolenExpiresAtMs > 0 && now >= player.stolenExpiresAtMs) {
        player.stolenAbilityId = null;
        player.stolenExpiresAtMs = 0;
      }

      player.lastStateAtMs = now;
      player.x = sanitized.x;
      player.y = sanitized.y;
      player.z = sanitized.z;
      player.yaw = sanitized.yaw;
      player.invulnerable = Boolean(sanitized.invulnerable);
      player.spawnProtected = now < player.spawnProtectedUntilMs;

      // Authoritative fields override client values before storing/relaying
      player.serverSeq += 1;
      const authoritativeMotion: PlayerMotionPacket = {
        ...sanitized,
        justJumped: false,
        landImpactSpeed: 0,
        hp: player.hp,
        maxHp: player.maxHp,
        dead: !player.alive,
        spawnProtected: player.spawnProtected,
        shieldKind: player.shieldKind,
        stolenAbilityId: player.stolenAbilityId,
        seq: player.serverSeq,
      };
      player.lastMotion = authoritativeMotion;

      const relay: RemotePlayerStateUpdate = {
        ...authoritativeMotion,
        justJumped: Boolean(sanitized.justJumped),
        landImpactSpeed: sanitized.landImpactSpeed ?? 0,
        playerId,
        serverTimeMs: now,
      };
      socket.to(room.code).emit('player:state', relay);

      if (characterChanged) {
        io.to(room.code).emit('room:update', buildRoomSnapshot(room));
      }
    });

    socket.on('player:abilityVfx', (rawVfx: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;

      const now = Date.now();
      if (!checkSocketActionRate(`vfx:${socket.id}`, 60, 1000)) return;
      if (!rawVfx || typeof rawVfx !== 'object' || Array.isArray(rawVfx)) return;
      const v = rawVfx as Partial<AbilityVfxPacket>;

      if (
        typeof v.originX !== 'number' ||
        !Number.isFinite(v.originX) ||
        typeof v.originY !== 'number' ||
        !Number.isFinite(v.originY) ||
        typeof v.originZ !== 'number' ||
        !Number.isFinite(v.originZ)
      ) {
        return;
      }

      if (typeof v.kind !== 'string' || !VALID_VFX_KINDS.has(v.kind)) return;

      player.lastVfxAtMs = now;
      const packet: AbilityVfxPacket = {
        playerId,
        kind: v.kind,
        abilityId: typeof v.abilityId === 'string' ? v.abilityId.slice(0, 40) : undefined,
        characterId:
          typeof v.characterId === 'string'
            ? resolveValidCharacterId(v.characterId)
            : player.characterId,
        skinId:
          v.skinId === null
            ? null
            : typeof v.skinId === 'string' && ALL_VALID_SKIN_IDS.has(v.skinId)
              ? v.skinId
              : player.skinId,
        stage: typeof v.stage === 'string' ? v.stage.slice(0, 32) : undefined,
        hand:
          v.hand === 'left' || v.hand === 'right' || v.hand === 'both'
            ? v.hand
            : undefined,
        targetPlayerId:
          typeof v.targetPlayerId === 'string' ? v.targetPlayerId.slice(0, 64) : undefined,
        castName: typeof v.castName === 'string' ? v.castName.slice(0, 40) : undefined,
        castDuration:
          typeof v.castDuration === 'number' && Number.isFinite(v.castDuration)
            ? clampFinite(v.castDuration, 0.05, 5.0, 0.35)
            : undefined,
        duration:
          typeof v.duration === 'number' && Number.isFinite(v.duration)
            ? clampFinite(v.duration, 0.05, 16.0, 1.0)
            : undefined,
        scale:
          typeof v.scale === 'number' && Number.isFinite(v.scale)
            ? clampFinite(v.scale, 0.2, 5.0, 1.0)
            : undefined,
        originX: clampFinite(v.originX, -WORLD_POS_BOUND, WORLD_POS_BOUND, player.x),
        originY: clampFinite(v.originY, -20, 180, player.y),
        originZ: clampFinite(v.originZ, -WORLD_POS_BOUND, WORLD_POS_BOUND, player.z),
        targetX:
          typeof v.targetX === 'number' && Number.isFinite(v.targetX)
            ? clampFinite(v.targetX, -WORLD_POS_BOUND, WORLD_POS_BOUND, player.x)
            : undefined,
        targetY:
          typeof v.targetY === 'number' && Number.isFinite(v.targetY)
            ? clampFinite(v.targetY, -20, 180, player.y)
            : undefined,
        targetZ:
          typeof v.targetZ === 'number' && Number.isFinite(v.targetZ)
            ? clampFinite(v.targetZ, -WORLD_POS_BOUND, WORLD_POS_BOUND, player.z)
            : undefined,
        colorHex:
          typeof v.colorHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.colorHex)
            ? v.colorHex
            : undefined,
        radius:
          typeof v.radius === 'number' && Number.isFinite(v.radius)
            ? clampFinite(v.radius, 0.4, 28, 3.5)
            : undefined,
      };
      socket.to(room.code).emit('player:abilityVfx', packet);
    });

    socket.on('combat:hit', (rawHit: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      const attacker = room.players.get(playerId);
      if (!attacker || !attacker.alive) return;

      const now = Date.now();
      if (now - attacker.lastCombatHitAtMs < 30) return;
      if (!rawHit || typeof rawHit !== 'object' || Array.isArray(rawHit)) return;
      const hit = rawHit as Partial<CombatHitRequest>;

      if (typeof hit.targetPlayerId !== 'string' || hit.targetPlayerId === playerId) {
        return;
      }
      const target = room.players.get(hit.targetPlayerId);
      if (!target || !target.alive || now < target.spawnProtectedUntilMs) return;

      const numericCheck = [hit.damage, hit.hitDirX, hit.hitDirY, hit.hitDirZ];
      for (const val of numericCheck) {
        if (typeof val !== 'number' || !Number.isFinite(val)) return;
      }

      const rawDamage = clampFinite(hit.damage, 0, 110, 0);
      const ragdollSec = clampFinite(hit.ragdollSec, 0, 4.5, 0);
      const knockX = clampFinite(hit.knockX, -28, 28, 0);
      const knockY = clampFinite(hit.knockY, -28, 28, 0);
      const knockZ = clampFinite(hit.knockZ, -28, 28, 0);
      const burnSec = clampFinite(hit.burnSec, 0, 6, 0);
      const burnDps = clampFinite(hit.burnDps, 0, 15, 0);
      const paralyzeSec = clampFinite(hit.paralyzeSec, 0, 4.5, 0);
      const headacheSec = clampFinite(hit.headacheSec, 0, 4.0, 0);
      const pushOnly = Boolean(hit.pushOnly);
      const isBeam = Boolean(hit.isBeam);

      if (
        rawDamage <= 0 &&
        ragdollSec <= 0 &&
        paralyzeSec <= 0 &&
        headacheSec <= 0 &&
        Math.hypot(knockX, knockY, knockZ) <= 0.05
      ) {
        return;
      }

      attacker.lastCombatHitAtMs = now;
      target.lastAttackerId = attacker.playerId;
      target.lastAttackedAtMs = now;

      let serverAppliedDamage = 0;
      if (!pushOnly && rawDamage > 0) {
        const res = applyServerDamage(
          io,
          room,
          target,
          rawDamage,
          attacker,
          isBeam,
          now,
        );
        serverAppliedDamage = res.appliedHpDamage;
      }

      const dirLen = Math.hypot(hit.hitDirX!, hit.hitDirY!, hit.hitDirZ!) || 1;
      const effect: CombatEffectEvent = {
        attackerPlayerId: attacker.playerId,
        targetPlayerId: target.playerId,
        damage: Math.round(rawDamage * 10) / 10,
        serverAppliedDamage: Math.round(serverAppliedDamage * 10) / 10,
        remainingHp: Math.round(target.hp * 10) / 10,
        hitDirX: hit.hitDirX! / dirLen,
        hitDirY: hit.hitDirY! / dirLen,
        hitDirZ: hit.hitDirZ! / dirLen,
        ragdollSec,
        knockX,
        knockY,
        knockZ,
        kind:
          hit.kind === 'weapon' ||
          hit.kind === 'punch' ||
          hit.kind === 'pistol' ||
          hit.kind === 'ai-ability'
            ? hit.kind
            : 'ai-ability',
        isBeam,
        burnSec,
        burnDps,
        paralyzeSec,
        headacheSec,
        pushOnly,
      };

      io.to(target.socketId).emit('combat:effect', effect);
    });

    socket.on('combat:heal', (rawHeal: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      const player = room?.players.get(playerId);
      if (!room || !player || !player.alive) return;
      const now = Date.now();
      if (now - player.lastHealAtMs < 60) return;
      if (!rawHeal || typeof rawHeal !== 'object' || Array.isArray(rawHeal)) return;
      const req = rawHeal as Partial<CombatHealRequest>;
      const target =
        typeof req.targetPlayerId === 'string' && req.targetPlayerId !== playerId
          ? room.players.get(req.targetPlayerId)
          : player;
      if (!target || !target.alive) return;
      const amount = clampFinite(req.amount, 0, target.maxHp, 0);
      if (amount <= 0) return;
      player.lastHealAtMs = now;
      target.hp = Math.min(target.maxHp, target.hp + amount);
      target.lastMotion = { ...target.lastMotion, hp: target.hp };
      io.to(room.code).emit('combat:vitals', buildVitalsEvent(target, now));
    });

    socket.on('combat:npcDamage', (rawDmg: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      const player = room?.players.get(playerId);
      if (!room || !player || !player.alive) return;
      if (!rawDmg || typeof rawDmg !== 'object' || Array.isArray(rawDmg)) return;
      const req = rawDmg as Partial<CombatNpcDamageRequest>;
      const amount = clampFinite(req.damage, 0, 110, 0);
      if (amount <= 0) return;
      applyServerDamage(io, room, player, amount, null, Boolean(req.isBeam), Date.now());
    });

    socket.on('combat:cc', (rawCc: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      const caster = room?.players.get(playerId);
      if (!room || !caster) return;
      if (!rawCc || typeof rawCc !== 'object' || Array.isArray(rawCc)) return;
      const cc = rawCc as Partial<CombatCrowdControlPacket>;
      if (
        typeof cc.targetPlayerId !== 'string' ||
        cc.targetPlayerId === playerId ||
        typeof cc.kind !== 'string' ||
        !VALID_CC_KINDS.has(cc.kind)
      ) {
        return;
      }
      const target = room.players.get(cc.targetPlayerId);
      if (!target) return;
      const now = Date.now();
      const active = Boolean(cc.active) && cc.kind !== 'clear';
      if (active && (!caster.alive || !target.alive || now < target.spawnProtectedUntilMs)) {
        return;
      }

      if (active) {
        caster.activeCcTargets.add(target.playerId);
      } else {
        caster.activeCcTargets.delete(target.playerId);
      }

      const packet: CombatCrowdControlPacket = {
        attackerPlayerId: caster.playerId,
        targetPlayerId: target.playerId,
        kind: cc.kind as CombatCrowdControlKind,
        active,
        durationMs:
          typeof cc.durationMs === 'number' && Number.isFinite(cc.durationMs)
            ? clampFinite(cc.durationMs, 0, 10_000, 3000)
            : undefined,
        x:
          typeof cc.x === 'number' && Number.isFinite(cc.x)
            ? clampFinite(cc.x, -WORLD_POS_BOUND, WORLD_POS_BOUND, target.x)
            : undefined,
        y:
          typeof cc.y === 'number' && Number.isFinite(cc.y)
            ? clampFinite(cc.y, -20, 180, target.y)
            : undefined,
        z:
          typeof cc.z === 'number' && Number.isFinite(cc.z)
            ? clampFinite(cc.z, -WORLD_POS_BOUND, WORLD_POS_BOUND, target.z)
            : undefined,
        yaw:
          typeof cc.yaw === 'number' && Number.isFinite(cc.yaw)
            ? wrapYawRadians(cc.yaw)
            : undefined,
        pose:
          cc.pose === 'kneel' || cc.pose === 'hang' || cc.pose === 'grabbed'
            ? cc.pose
            : undefined,
        forcefieldMode:
          cc.forcefieldMode === 'locked' ||
          cc.forcefieldMode === 'protection' ||
          cc.forcefieldMode === 'suffocation' ||
          cc.forcefieldMode === 'none'
            ? cc.forcefieldMode
            : undefined,
        seq:
          typeof cc.seq === 'number' && Number.isFinite(cc.seq) ? cc.seq : undefined,
        serverTimeMs: now,
      };
      io.to(room.code).emit('combat:cc', packet);
    });

    socket.on('vampire:absorb', (rawReq: unknown) => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      const vampire = room?.players.get(playerId);
      if (!room || !vampire || vampire.characterId !== 'vampire') return;
      if (!rawReq || typeof rawReq !== 'object' || Array.isArray(rawReq)) return;
      const req = rawReq as Partial<VampireAbsorbRequest>;
      if (typeof req.targetPlayerId !== 'string' || req.targetPlayerId === playerId) {
        return;
      }
      const target = room.players.get(req.targetPlayerId);
      if (!target) return;
      const now = Date.now();

      if (req.phase === 'start') {
        if (!vampire.alive || !target.alive || now < target.spawnProtectedUntilMs) return;
        const dist = Math.hypot(
          target.x - vampire.x,
          target.y - vampire.y,
          target.z - vampire.z,
        );
        if (dist > 10.5) return;
        vampire.pendingAbsorbTargetId = target.playerId;
        const evt: VampireAbsorbEvent = {
          vampirePlayerId: vampire.playerId,
          targetPlayerId: target.playerId,
          phase: 'start',
          stolenAbilityId: null,
          sourceCharacterId: target.characterId,
          sourceSkinId: target.skinId,
          stolenDurationMs: VAMPIRE_STOLEN_DURATION_MS,
          targetX:
            typeof req.targetX === 'number' && Number.isFinite(req.targetX)
              ? clampFinite(req.targetX, -WORLD_POS_BOUND, WORLD_POS_BOUND, target.x)
              : target.x,
          targetY:
            typeof req.targetY === 'number' && Number.isFinite(req.targetY)
              ? clampFinite(req.targetY, -20, 180, target.y)
              : target.y,
          targetZ:
            typeof req.targetZ === 'number' && Number.isFinite(req.targetZ)
              ? clampFinite(req.targetZ, -WORLD_POS_BOUND, WORLD_POS_BOUND, target.z)
              : target.z,
          targetYaw:
            typeof req.targetYaw === 'number' && Number.isFinite(req.targetYaw)
              ? wrapYawRadians(req.targetYaw)
              : target.yaw,
          serverTimeMs: now,
        };
        io.to(room.code).emit('vampire:absorb', evt);
        return;
      }

      if (req.phase === 'cancel') {
        vampire.pendingAbsorbTargetId = null;
        const evt: VampireAbsorbEvent = {
          vampirePlayerId: vampire.playerId,
          targetPlayerId: target.playerId,
          phase: 'cancel',
          stolenAbilityId: null,
          sourceCharacterId: target.characterId,
          sourceSkinId: target.skinId,
          stolenDurationMs: 0,
          serverTimeMs: now,
        };
        io.to(room.code).emit('vampire:absorb', evt);
        return;
      }

      if (req.phase === 'complete') {
        if (!vampire.alive) return;
        vampire.pendingAbsorbTargetId = null;
        const pool = getServerStealablePool(target.characterId, target.skinId);
        const pickedAbilityId =
          pool[crypto.randomInt(0, pool.length)] ?? 'chaos-bolt';
        vampire.stolenAbilityId = pickedAbilityId;
        vampire.stolenExpiresAtMs = now + VAMPIRE_STOLEN_DURATION_MS;
        vampire.lastMotion = {
          ...vampire.lastMotion,
          stolenAbilityId: pickedAbilityId,
        };

        // Heal Rogue +15 HP authoritatively
        vampire.hp = Math.min(vampire.maxHp, vampire.hp + 15);
        vampire.lastMotion.hp = vampire.hp;
        io.to(room.code).emit('combat:vitals', buildVitalsEvent(vampire, now));

        const evt: VampireAbsorbEvent = {
          vampirePlayerId: vampire.playerId,
          targetPlayerId: target.playerId,
          phase: 'complete',
          stolenAbilityId: pickedAbilityId,
          sourceCharacterId: target.characterId,
          sourceSkinId: target.skinId,
          stolenDurationMs: VAMPIRE_STOLEN_DURATION_MS,
          serverTimeMs: now,
        };
        io.to(room.code).emit('vampire:absorb', evt);
        io.to(room.code).emit('room:update', buildRoomSnapshot(room));
      }
    });

    socket.on('combat:death', () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      const victim = room.players.get(playerId);
      if (!victim) return;

      const wasAlive = victim.alive;
      victim.alive = false;
      victim.hp = 0;
      victim.shieldKind = null;
      victim.shieldRemaining = 0;
      victim.stolenAbilityId = null;
      victim.stolenExpiresAtMs = 0;
      victim.pendingAbsorbTargetId = null;
      victim.lastMotion = {
        ...victim.lastMotion,
        dead: true,
        hp: 0,
        ragdoll: true,
        shieldKind: null,
        stolenAbilityId: null,
      };
      clearCasterCrowdControls(io, room, victim);

      const now = Date.now();
      if (
        wasAlive &&
        victim.lastAttackerId &&
        now - victim.lastAttackedAtMs <= 8000
      ) {
        const killer = room.players.get(victim.lastAttackerId);
        if (killer && killer.playerId !== victim.playerId) {
          io.to(killer.socketId).emit('combat:elimination', {
            victimPlayerId: victim.playerId,
            victimName: victim.name,
            rewardCoins: 25,
          });
        }
      }
      victim.lastAttackerId = null;

      io.to(room.code).emit('combat:vitals', buildVitalsEvent(victim, now));
      io.to(room.code).emit('room:update', buildRoomSnapshot(room));
    });

    socket.on('combat:respawn', () => {
      const roomCode = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;

      const now = Date.now();
      player.alive = true;
      player.hp = player.maxHp;
      player.spawnProtected = true;
      player.spawnProtectedUntilMs = now + SPAWN_PROTECTION_MS;
      player.invulnerable = false;
      player.shieldKind = null;
      player.shieldRemaining = 0;
      player.shieldExpiresAtMs = 0;
      player.silverAbsorbEnergy = 0;
      player.stolenAbilityId = null;
      player.stolenExpiresAtMs = 0;
      player.pendingAbsorbTargetId = null;
      player.lastSeq = 0;
      player.lastAttackerId = null;
      player.lastMotion = {
        ...player.lastMotion,
        dead: false,
        hp: player.maxHp,
        ragdoll: false,
        spawnProtected: true,
        shieldKind: null,
        stolenAbilityId: null,
      };
      io.to(room.code).emit('combat:vitals', buildVitalsEvent(player, now));
      io.to(room.code).emit('room:update', buildRoomSnapshot(room));
    });

    socket.on('disconnect', () => {
      socketActionWindows.delete(socket.id);
      socketActionWindows.delete(`vfx:${socket.id}`);
      removePlayerFromCurrentRoom(io, socket);
    });
  });

  return io;
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const allowed = parseAllowedOrigins();
    const requestOrigin = req.header('origin')?.replace(/\/+$/, '');
    if (allowed === true) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    } else if (requestOrigin && allowed.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const healthHandler = (_req: Request, res: Response) => {
    res.json({
      ok: true,
      serverTimeMs: Date.now(),
      activeRooms: rooms.size,
    });
  };
  app.get('/api/health', healthHandler);
  app.get('/healthz', healthHandler);

  app.get('/api/tts/character', async (req: Request, res: Response) => {
    const rawName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!rawName || !CHARACTER_NAME_PATTERN.test(rawName)) {
      res.status(400).json({ ok: false, error: 'Invalid character name' });
      return;
    }
    const wav = await synthesizeCharacterNameWav(rawName);
    if (!wav) {
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(wav);
  });

  app.get('/api/session/restore', (req: Request, res: Response) => {
    const sessionId = resolveSessionId(req);
    const record = getOrCreateSession(sessionId);
    res.json({
      ok: true,
      sessionId: record.sessionId,
      state: record.state,
      serverTimeMs: Date.now(),
    });
  });

  app.post('/api/session/validate', (req: Request, res: Response) => {
    const sessionId = resolveSessionId(req);
    const record = getOrCreateSession(sessionId);
    record.state = validateAndMergeState(record.state, req.body);
    record.lastTouchedMs = Date.now();
    res.json({
      ok: true,
      sessionId: record.sessionId,
      state: record.state,
      serverTimeMs: Date.now(),
    });
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  if (!IS_PROD) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR, { index: false }));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      const indexPath = path.resolve(DIST_DIR, 'index.html');
      if (!indexPath.startsWith(DIST_DIR + path.sep) || !fs.existsSync(indexPath)) {
        if (req.path === '/') {
          res.json({
            ok: true,
            service: 'multiplayer-server',
            activeRooms: rooms.size,
          });
          return;
        }
        next();
        return;
      }
      res.sendFile(indexPath);
    });
  }

  const httpServer = http.createServer(app);
  attachMultiplayerSocketServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
