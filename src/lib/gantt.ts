import { TaskStatus } from "@prisma/client";
import { DASHBOARD_TONE_OPTIONS } from "@/lib/dashboard-tones";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const LABEL_WIDTH = 190;
export const LANE_HEIGHT = 40;
export const BAR_HEIGHT = 30;
export const TIMELINE_WIDTH = 1020;

export const ZOOM_OPTIONS = {
  "1m": { label: "1 mes", months: 1, headerMode: "weeks" },
  "2m": { label: "2 meses", months: 2, headerMode: "weeks" },
  "3m": { label: "3 meses", months: 3, headerMode: "half-months" },
  "6m": { label: "6 meses", months: 6, headerMode: "months" },
  "1y": { label: "1 año", months: 12, headerMode: "bimesters" },
} as const;

const toneSwatchMap = Object.fromEntries(
  DASHBOARD_TONE_OPTIONS.map((option) => [option.value, option.swatch]),
) as Record<(typeof DASHBOARD_TONE_OPTIONS)[number]["value"], string>;

const clientToneMap: Record<string, string> = {
  SCIO: "border-sky-200/70 bg-sky-100/85 text-sky-900",
  MAQUEX: "border-emerald-200/70 bg-emerald-100/85 text-emerald-900",
  HULMEC: "border-amber-200/70 bg-amber-100/90 text-amber-950",
  BLAIR: "border-fuchsia-200/70 bg-fuchsia-100/85 text-fuchsia-900",
  NEWELL: "border-violet-200/70 bg-violet-100/85 text-violet-900",
  ORBIT: "border-slate-200/80 bg-slate-100/90 text-slate-800",
};

export function getBarSwatch(tone: string | null | undefined) {
  if (!tone) return toneSwatchMap.OCEAN;
  return toneSwatchMap[tone as keyof typeof toneSwatchMap] ?? toneSwatchMap.OCEAN;
}

export function getClientTone(client: string | null | undefined) {
  if (!client) {
    return clientToneMap.ORBIT;
  }
  return clientToneMap[client] ?? clientToneMap.ORBIT;
}

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

export function diffInDays(start: Date, end: Date) {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS);
}

export function getDurationDays(start: Date, end: Date) {
  return Math.max(diffInDays(start, end) + 1, 1);
}

export function rangeLabel(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function getIsoWeekInfo(date: Date) {
  const target = startOfDay(date);
  const dayNumber = target.getDay() || 7;
  target.setDate(target.getDate() + 4 - dayNumber);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);

  return {
    week,
    year: target.getFullYear(),
  };
}

export function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
  }).format(date);
}

export function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function getTaskSchedule(task: {
  createdAt: Date;
  startedAt: Date | null;
  dueDate: Date | null;
  expectedDoneAt: Date | null;
}) {
  const start = startOfDay(task.startedAt ?? task.createdAt);
  const targetEnd = task.dueDate ? startOfDay(task.dueDate) : task.expectedDoneAt ? startOfDay(task.expectedDoneAt) : null;

  if (!targetEnd) {
    return null;
  }

  const end = targetEnd.getTime() < start.getTime() ? start : targetEnd;

  return {
    start,
    end,
  };
}

export function assignLanes<T extends { schedule: { start: Date; end: Date } }>(items: T[]) {
  const laneEndTimes: number[] = [];

  return items.map((item) => {
    const startTime = item.schedule.start.getTime();
    const endTime = item.schedule.end.getTime();
    let laneIndex = laneEndTimes.findIndex((laneEndTime) => laneEndTime < startTime);

    if (laneIndex === -1) {
      laneIndex = laneEndTimes.length;
      laneEndTimes.push(endTime);
    } else {
      laneEndTimes[laneIndex] = endTime;
    }

    return {
      ...item,
      laneIndex,
    };
  });
}

export function getTaskTone(
  task: { status: TaskStatus },
  schedule: { start: Date; end: Date },
  today: Date,
) {
  const todayTime = today.getTime();
  const isUpcoming = schedule.start.getTime() > todayTime || task.status === TaskStatus.PENDING;

  return {
    barClassName: isUpcoming
      ? "border-white/40 opacity-75 saturate-[0.82] brightness-110"
      : "border-white/55 opacity-100 saturate-100",
    textClassName: isUpcoming ? "text-white/90" : "text-white",
  };
}


