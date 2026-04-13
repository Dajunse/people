import Link from "next/link";
import { TaskStatus } from "@prisma/client";
import { GanttTaskEditor } from "@/components/gantt-task-editor";
import { getAvatarPreset } from "@/lib/avatar-presets";
import { DASHBOARD_TONE_OPTIONS } from "@/lib/dashboard-tones";
import { getCurrentUser } from "@/lib/auth";
import { taskClientLabel } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_WIDTH = 220;
const LANE_HEIGHT = 58;
const BAR_HEIGHT = 40;

const ZOOM_OPTIONS = {
  "1w": { label: "Semana", days: 7, dayWidth: 110 },
  "2w": { label: "2 semanas", days: 14, dayWidth: 84 },
  "3w": { label: "3 semanas", days: 21, dayWidth: 68 },
  "1m": { label: "1 mes", days: 31, dayWidth: 56 },
  "2m": { label: "2 meses", days: 62, dayWidth: 40 },
} as const;

type ScheduledTask = {
  id: string;
  title: string;
  description: string | null;
  client: string | null;
  status: TaskStatus;
  assigneeId: string;
  createdAt: Date;
  startedAt: Date | null;
  dueDate: Date | null;
  expectedDoneAt: Date | null;
};

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

function getBarSwatch(tone: string | null | undefined) {
  if (!tone) return toneSwatchMap.OCEAN;
  return toneSwatchMap[tone as keyof typeof toneSwatchMap] ?? toneSwatchMap.OCEAN;
}

function getClientTone(client: string | null | undefined) {
  if (!client) {
    return clientToneMap.ORBIT;
  }
  return clientToneMap[client] ?? clientToneMap.ORBIT;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function diffInDays(start: Date, end: Date) {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS);
}

function rangeLabel(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function getIsoWeekInfo(date: Date) {
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

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
  }).format(date);
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getTaskSchedule(task: ScheduledTask) {
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

function assignLanes<T extends { schedule: { start: Date; end: Date } }>(items: T[]) {
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

function getTaskTone(task: ScheduledTask, schedule: { start: Date; end: Date }, today: Date) {
  const todayTime = today.getTime();
  const isCurrent =
    task.status !== TaskStatus.PENDING &&
    schedule.start.getTime() <= todayTime &&
    schedule.end.getTime() >= todayTime;
  const isUpcoming = schedule.start.getTime() > todayTime || task.status === TaskStatus.PENDING;

  return {
    isCurrent,
    barClassName: isUpcoming
      ? "border-white/40 opacity-75 saturate-[0.82] brightness-110"
      : "border-white/55 opacity-100 saturate-100",
    textClassName: isUpcoming ? "text-white/90" : "text-white",
    subtextClassName: isUpcoming ? "text-white/75" : "text-white/85",
  };
}

export default async function PublicGanttPage({
  searchParams,
}: {
  searchParams: Promise<{
    zoom?: string | string[];
    taskId?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const requestedZoom = firstValue(resolvedSearchParams.zoom) ?? "3w";
  const selectedTaskId = firstValue(resolvedSearchParams.taskId) ?? "";
  const zoomKey = requestedZoom in ZOOM_OPTIONS ? (requestedZoom as keyof typeof ZOOM_OPTIONS) : "3w";
  const zoom = ZOOM_OPTIONS[zoomKey];

  const currentUser = await getCurrentUser();

  const [collaborators, selectedTask] = await Promise.all([
    prisma.user.findMany({
      where: { role: "COLLABORATOR", isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        dashboardTone: true,
        avatarPreset: true,
        assignedTasks: {
          where: {
            status: {
              in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.ALMOST_DONE],
            },
          },
          orderBy: [{ startedAt: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            description: true,
            client: true,
            status: true,
            assigneeId: true,
            createdAt: true,
            startedAt: true,
            dueDate: true,
            expectedDoneAt: true,
          },
        },
      },
    }),
    currentUser && selectedTaskId
      ? prisma.task.findUnique({
          where: { id: selectedTaskId },
          select: {
            id: true,
            title: true,
            description: true,
            client: true,
            status: true,
            assigneeId: true,
            startedAt: true,
            dueDate: true,
            expectedDoneAt: true,
            assignee: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const scheduledEntries = collaborators.flatMap((collaborator) =>
    collaborator.assignedTasks
      .map((task) => {
        const schedule = getTaskSchedule(task);
        if (!schedule) {
          return null;
        }
        return { task, schedule, collaboratorId: collaborator.id };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  );

  const today = startOfDay(new Date());
  const rangeStart = scheduledEntries.length
    ? addDays(
        scheduledEntries.reduce(
          (min, entry) => (entry.schedule.start.getTime() < min.getTime() ? entry.schedule.start : min),
          scheduledEntries[0].schedule.start,
        ),
        -1,
      )
    : addDays(today, -2);
  const rangeEnd = addDays(rangeStart, zoom.days - 1);

  const dayCount = Math.max(diffInDays(rangeStart, rangeEnd) + 1, 1);
  const days = Array.from({ length: dayCount }, (_, index) => addDays(rangeStart, index));
  const timelineWidth = dayCount * zoom.dayWidth;
  const weekGroups: Array<{ key: string; label: string; span: number }> = [];

  for (const day of days) {
    const info = getIsoWeekInfo(day);
    const key = `${info.year}-${info.week}`;
    const currentGroup = weekGroups.at(-1);

    if (currentGroup && currentGroup.key === key) {
      currentGroup.span += 1;
      continue;
    }

    weekGroups.push({
      key,
      label: `Semana ${info.week}`,
      span: 1,
    });
  }

  return (
    <main className="min-h-screen bg-[#f4f6f8] px-6 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-[1900px] space-y-5">
        <header className="rounded-[32px] border border-slate-200 bg-white px-6 py-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">People Gantt Publico</p>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Linea de tiempo del equipo</h1>
              <p className="max-w-3xl text-sm text-slate-500">
                Vista minimalista para leer el progreso del equipo por rango de trabajo. La barra muestra inicio y fin objetivo.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/public"
                className="rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-200"
              >
                Portal publico
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                Login
              </Link>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-sm text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              {collaborators.length} colaboradores
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              {scheduledEntries.length} tareas activas
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              Rango: {formatDate(rangeStart)} - {formatDate(rangeEnd)}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              Linea vertical: hoy
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              {currentUser ? "Edicion activa en tareas permitidas" : "Inicia sesion para editar tareas"}
            </span>
          </div>
        </header>

        <section className="rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-2 text-xs uppercase tracking-[0.18em] text-slate-400">Zoom</p>
            {(Object.entries(ZOOM_OPTIONS) as Array<[keyof typeof ZOOM_OPTIONS, (typeof ZOOM_OPTIONS)[keyof typeof ZOOM_OPTIONS]]>).map(([key, option]) => {
              const active = key === zoomKey;

              return (
                <Link
                  key={key}
                  href={`/public/gantt?zoom=${key}`}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="overflow-x-auto rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.24)]">
          <div style={{ minWidth: `${timelineWidth + LABEL_WIDTH + 24}px` }}>
            <div className="mb-4 flex items-end gap-4 border-b border-slate-200 pb-4">
              <div className="shrink-0" style={{ width: `${LABEL_WIDTH}px` }}>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Colaborador</p>
              </div>
              <div className="shrink-0" style={{ width: `${timelineWidth}px` }}>
                <div
                  className="grid border-b border-slate-200 pb-2"
                  style={{ gridTemplateColumns: `repeat(${dayCount}, ${zoom.dayWidth}px)` }}
                >
                  {weekGroups.map((group) => (
                    <div
                      key={group.key}
                      className="flex items-center justify-center border-l border-slate-200 px-2 first:border-l-0"
                      style={{ gridColumn: `span ${group.span} / span ${group.span}` }}
                    >
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        {group.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  className="grid shrink-0 gap-0 pt-2"
                  style={{ gridTemplateColumns: `repeat(${dayCount}, ${zoom.dayWidth}px)` }}
                >
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "border-l border-slate-200 px-1 text-center first:border-l-0",
                        isWeekend(day) ? "bg-slate-50/80" : "",
                      )}
                    >
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{weekdayLabel(day)}</p>
                      <p className="mt-1 text-xs font-medium text-slate-700">{rangeLabel(day)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {collaborators.map((collaborator) => {
                const avatar = getAvatarPreset(collaborator.avatarPreset);
                const barSwatch = getBarSwatch(collaborator.dashboardTone);
                const canEditCollaboratorTasks = currentUser
                  ? currentUser.role === "ADMIN" || currentUser.id === collaborator.id
                  : false;
                const taskEntries = collaborator.assignedTasks.flatMap((task) => {
                  const schedule = getTaskSchedule(task);
                  return schedule ? [{ task, schedule }] : [];
                });
                const scheduledTasks = assignLanes(taskEntries);

                const laneCount = Math.max(
                  scheduledTasks.reduce((max, item) => Math.max(max, item.laneIndex + 1), 0),
                  1,
                );
                const rowHeight = laneCount * LANE_HEIGHT;

                return (
                  <article key={collaborator.id} className="flex items-stretch gap-4">
                    <div
                      className="flex shrink-0 items-center justify-start rounded-[28px] border border-slate-200 bg-white px-5"
                      style={{ width: `${LABEL_WIDTH}px`, minHeight: `${rowHeight}px` }}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br text-2xl shadow-sm ${avatar.swatch}`}>
                          {avatar.emoji}
                        </span>
                        <div>
                          <p className="text-lg font-semibold text-slate-900">{collaborator.name}</p>
                        </div>
                      </div>
                    </div>

                    <div
                      className="relative shrink-0 overflow-visible rounded-[28px] border border-slate-200 bg-slate-50"
                      style={{ width: `${timelineWidth}px`, height: `${rowHeight}px` }}
                    >
                      <div
                        className="grid h-full"
                        style={{
                          gridTemplateColumns: `repeat(${dayCount}, ${zoom.dayWidth}px)`,
                          gridTemplateRows: `repeat(${laneCount}, ${LANE_HEIGHT}px)`,
                        }}
                      >
                        {Array.from({ length: laneCount }).map((_, laneIndex) =>
                          days.map((day) => (
                            <div
                              key={`${collaborator.id}-${laneIndex}-${day.toISOString()}`}
                              className={cn(
                                "border-l border-t border-slate-200 first:border-l-0",
                                isWeekend(day) ? "bg-slate-100/60" : "bg-white/55",
                              )}
                            />
                          )),
                        )}
                      </div>

                      {today.getTime() >= rangeStart.getTime() && today.getTime() <= rangeEnd.getTime() ? (
                        <div
                          className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-slate-950/75"
                          style={{ left: `${diffInDays(rangeStart, today) * zoom.dayWidth + zoom.dayWidth / 2}px` }}
                        >
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white">
                            Hoy
                          </span>
                        </div>
                      ) : null}

                      {scheduledTasks.length > 0 ? (
                        scheduledTasks.map(({ task, schedule, laneIndex }) => {
                          if (schedule.end.getTime() < rangeStart.getTime() || schedule.start.getTime() > rangeEnd.getTime()) {
                            return null;
                          }

                          const visibleStart = schedule.start.getTime() < rangeStart.getTime() ? rangeStart : schedule.start;
                          const visibleEnd = schedule.end.getTime() > rangeEnd.getTime() ? rangeEnd : schedule.end;
                          const visibleStartOffset = diffInDays(rangeStart, visibleStart);
                          const visibleEndOffset = diffInDays(rangeStart, visibleEnd);
                          const left = visibleStartOffset * zoom.dayWidth + 8;
                          const width = Math.max((visibleEndOffset - visibleStartOffset + 1) * zoom.dayWidth - 14, 32);
                          const top = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;
                          const tone = getTaskTone(task, schedule, today);
                          const clientTone = getClientTone(task.client);
                          const statusLabel =
                            task.status === TaskStatus.PENDING
                              ? "Pendiente"
                              : task.status === TaskStatus.IN_PROGRESS
                                ? "En progreso"
                                : task.status === TaskStatus.ALMOST_DONE
                                  ? "Casi lista"
                                  : "Completada";

                          return (
                            <div key={task.id}>
                              {canEditCollaboratorTasks ? (
                                <Link
                                  href={`/public/gantt?zoom=${zoomKey}&taskId=${task.id}`}
                                  className={`group absolute rounded-[20px] border bg-gradient-to-r px-3 py-3 shadow-[0_12px_30px_-16px_rgba(15,23,42,0.85)] transition hover:z-20 hover:shadow-[0_24px_45px_-20px_rgba(15,23,42,0.45)] ${barSwatch} ${tone.barClassName} ${selectedTaskId === task.id ? "ring-2 ring-slate-950/20" : ""}`}
                                  style={{
                                    left: `${left}px`,
                                    top: `${top}px`,
                                    width: `${width}px`,
                                    minHeight: `${BAR_HEIGHT}px`,
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`truncate text-sm font-semibold ${tone.textClassName}`}>{task.title}</p>
                                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${clientTone}`}>
                                        {taskClientLabel(task.client)}
                                      </span>
                                    </div>
                                    <div className="mt-0 max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:mt-2 group-hover:max-h-32 group-hover:opacity-100">
                                      {task.description ? (
                                        <p className="text-xs leading-5 text-white/92">{task.description}</p>
                                      ) : (
                                        <p className="text-xs leading-5 text-white/78">Sin descripcion adicional.</p>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/82">
                                        <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                                          Estado: {statusLabel}
                                        </span>
                                        <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                                          Inicio: {formatDate(schedule.start)}
                                        </span>
                                        <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                                          Fin: {formatDate(schedule.end)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </Link>
                              ) : (
                                <div
                                  className={`group absolute rounded-[20px] border bg-gradient-to-r px-3 py-3 shadow-[0_12px_30px_-16px_rgba(15,23,42,0.85)] transition hover:z-20 hover:shadow-[0_24px_45px_-20px_rgba(15,23,42,0.45)] ${barSwatch} ${tone.barClassName}`}
                                  style={{
                                    left: `${left}px`,
                                    top: `${top}px`,
                                    width: `${width}px`,
                                    minHeight: `${BAR_HEIGHT}px`,
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`truncate text-sm font-semibold ${tone.textClassName}`}>{task.title}</p>
                                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${clientTone}`}>
                                        {taskClientLabel(task.client)}
                                      </span>
                                    </div>
                                    <div className="mt-0 max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:mt-2 group-hover:max-h-32 group-hover:opacity-100">
                                      {task.description ? (
                                        <p className="text-xs leading-5 text-white/92">{task.description}</p>
                                      ) : (
                                        <p className="text-xs leading-5 text-white/78">Sin descripcion adicional.</p>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/82">
                                        <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                                          Estado: {statusLabel}
                                        </span>
                                        <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                                          Inicio: {formatDate(schedule.start)}
                                        </span>
                                        <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                                          Fin: {formatDate(schedule.end)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                            </div>
                          );
                        })
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center px-6">
                          <p className="rounded-full border border-dashed border-slate-300 bg-white/80 px-4 py-2 text-sm text-slate-500">
                            Sin tareas con fechas para esta persona.
                          </p>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {collaborators.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  No hay colaboradores activos para mostrar en esta linea del tiempo.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {currentUser && selectedTask && (currentUser.role === "ADMIN" || selectedTask.assigneeId === currentUser.id) ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/28 px-4 py-8 backdrop-blur-[3px]">
          <Link
            href={`/public/gantt?zoom=${zoomKey}`}
            aria-label="Cerrar editor"
            className="absolute inset-0"
          />
          <div className="relative z-10 mx-auto flex min-h-full w-full max-w-5xl items-center">
            <GanttTaskEditor
              currentUser={currentUser}
              task={selectedTask}
              collaborators={collaborators.map((collaborator) => ({ id: collaborator.id, name: collaborator.name }))}
              zoomKey={zoomKey}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
