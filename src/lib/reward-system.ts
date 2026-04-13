import { RankTier } from "@prisma/client";

export const RANK_TIER_VALUES = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "CHALLENGER",
] as const;

export const RANK_ORDER: RankTier[] = [
  RankTier.IRON,
  RankTier.BRONZE,
  RankTier.SILVER,
  RankTier.GOLD,
  RankTier.PLATINUM,
  RankTier.DIAMOND,
  RankTier.CHALLENGER,
];

export const RANK_META: Record<RankTier, { label: string; icon: string; chip: string }> = {
  IRON: { label: "Hierro", icon: "\u{1FAA8}", chip: "border-zinc-400 bg-zinc-100 text-zinc-800" },
  BRONZE: { label: "Bronce", icon: "\u{1F949}", chip: "border-amber-500/40 bg-amber-100 text-amber-900" },
  SILVER: { label: "Plata", icon: "\u{1F948}", chip: "border-slate-400/50 bg-slate-100 text-slate-800" },
  GOLD: { label: "Oro", icon: "\u{1F947}", chip: "border-yellow-400/60 bg-yellow-100 text-yellow-900" },
  PLATINUM: { label: "Platino", icon: "\u{1F4A0}", chip: "border-cyan-400/50 bg-cyan-100 text-cyan-900" },
  DIAMOND: { label: "Diamante", icon: "\u{1F48E}", chip: "border-indigo-400/50 bg-indigo-100 text-indigo-900" },
  CHALLENGER: { label: "Challenger", icon: "\u{1F451}", chip: "border-fuchsia-400/50 bg-fuchsia-100 text-fuchsia-900" },
};

export type RewardSystemSettings = {
  starsPerWeekTarget: number;
  weeksRequiredPerRank: number;
};

type CompletedTask = {
  createdAt: Date;
  completedAt: Date | null;
  starValue: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfIsoWeek(date: Date) {
  const base = new Date(date);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diffToMonday);
  base.setHours(0, 0, 0, 0);
  return base;
}

function shiftWeeks(date: Date, amount: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount * 7);
  return shifted;
}

function weekKey(date: Date) {
  const weekStart = startOfIsoWeek(date);
  return weekStart.toISOString().slice(0, 10);
}

export function givesStar(task: CompletedTask) {
  if (!task.completedAt) return false;
  return task.completedAt.getTime() - task.createdAt.getTime() <= 7 * DAY_MS;
}

export function calculateRankProgress(
  tasks: CompletedTask[],
  settings: RewardSystemSettings,
  startingRank: RankTier = RankTier.IRON,
  now = new Date(),
) {
  const starsByWeek = new Map<string, number>();
  let totalStars = 0;

  for (const task of tasks) {
    if (!givesStar(task) || !task.completedAt) continue;
    const stars = Math.max(1, Math.min(5, Math.trunc(task.starValue || 1)));
    totalStars += stars;
    const key = weekKey(task.completedAt);
    starsByWeek.set(key, (starsByWeek.get(key) ?? 0) + stars);
  }

  const currentWeekKey = weekKey(now);
  const currentWeekStars = starsByWeek.get(currentWeekKey) ?? 0;

  let streakWeeks = 0;
  let pointer = startOfIsoWeek(now);
  const maxLookbackWeeks = 104;
  for (let i = 0; i < maxLookbackWeeks; i += 1) {
    const key = weekKey(pointer);
    const stars = starsByWeek.get(key) ?? 0;
    if (stars >= settings.starsPerWeekTarget) {
      streakWeeks += 1;
      pointer = shiftWeeks(pointer, -1);
      continue;
    }
    break;
  }

  const rankSteps = Math.floor(streakWeeks / settings.weeksRequiredPerRank);
  const startingRankIndex = RANK_ORDER.indexOf(startingRank);
  const safeStartingRankIndex = startingRankIndex >= 0 ? startingRankIndex : 0;
  const finalRankIndex = Math.min(
    safeStartingRankIndex + rankSteps,
    RANK_ORDER.length - 1,
  );
  const rank = RANK_ORDER[finalRankIndex];
  const nextRank = RANK_ORDER[finalRankIndex + 1] ?? null;
  const weeksIntoRank = streakWeeks % settings.weeksRequiredPerRank;
  const weeksToNextRank = nextRank ? Math.max(settings.weeksRequiredPerRank - weeksIntoRank, 0) : 0;

  return {
    totalStars,
    currentWeekStars,
    streakWeeks,
    rank,
    nextRank,
    weeksToNextRank,
  };
}


