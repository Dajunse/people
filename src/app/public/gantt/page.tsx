import Link from "next/link";
import { Role, TaskStatus } from "@prisma/client";
import { GanttTaskEditor } from "@/components/gantt-task-editor";
import { PublicGanttBoard } from "@/components/public-gantt-board";
import { getAvatarPreset } from "@/lib/avatar-presets";
import { getCurrentUser } from "@/lib/auth";
import {
  LABEL_WIDTH,
  TIMELINE_WIDTH,
  ZOOM_OPTIONS,
  addDays,
  addMonths,
  diffInDays,
  firstValue,
  getIsoWeekInfo,
  isWeekend,
  rangeLabel,
  startOfDay,
  weekdayLabel,
} from "@/lib/gantt";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";

export const dynamic = "force-dynamic";

const ZOOM_SEQUENCE = ["1m", "2m", "3m", "6m", "1y"] as const;
const STAFF_ROLES: Role[] = [Role.COLLABORATOR, Role.MANAGER];

type TimelineGroup = {
  key: string;
  label: string;
  span: number;
};

function toDateParam(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateParam(value: string | null | undefined) {
  if (!value) return null;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number.parseInt(yearText ?? "", 10);
  const month = Number.parseInt(monthText ?? "", 10);
  const day = Number.parseInt(dayText ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return startOfDay(new Date(year, month - 1, day));
}

function shiftAnchorByZoom(anchorDate: Date, zoomKey: keyof typeof ZOOM_OPTIONS, direction: -1 | 1) {
  if (zoomKey === "1m") {
    return addDays(anchorDate, 7 * direction);
  }
  if (zoomKey === "2m") {
    return addDays(anchorDate, 14 * direction);
  }
  if (zoomKey === "3m") {
    return addDays(anchorDate, 21 * direction);
  }
  if (zoomKey === "6m") {
    return addMonths(anchorDate, direction);
  }
  return addMonths(anchorDate, 2 * direction);
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

function buildMonthGroups(days: Date[]) {
  const groups: TimelineGroup[] = [];

  for (const day of days) {
    const month = day.getMonth();
    const year = day.getFullYear();
    const key = `${year}-${month}`;
    const label = monthLabel(day);

    const currentGroup = groups.at(-1);
    if (currentGroup && currentGroup.key === key) {
      currentGroup.span += 1;
      continue;
    }

    groups.push({ key, label, span: 1 });
  }

  return groups;
}

function buildWeekHeaderGroups(days: Date[], zoomKey: keyof typeof ZOOM_OPTIONS) {
  const isShortRange = zoomKey === "1m";
  if (isShortRange) {
    const weekGroups: TimelineGroup[] = [];

    for (const day of days) {
      const isoWeek = getIsoWeekInfo(day);
      const key = `${isoWeek.year}-w${isoWeek.week}`;
      const label = `Sem ${isoWeek.week}`;
      const current = weekGroups.at(-1);

      if (current && current.key === key) {
        current.span += 1;
        continue;
      }

      weekGroups.push({ key, label, span: 1 });
    }

    return weekGroups;
  }

  const monthGroups = buildMonthGroups(days);
  let startIndex = 0;
  return monthGroups.map((group) => {
    const endIndex = startIndex + group.span - 1;
    const startWeek = getIsoWeekInfo(days[startIndex]).week;
    const endWeek = getIsoWeekInfo(days[endIndex]).week;
    const label = startWeek === endWeek ? `Sem ${startWeek}` : `Sem ${startWeek}-${endWeek}`;
    startIndex += group.span;

    return {
      key: `week-range-${group.key}`,
      label,
      span: group.span,
    };
  });
}

function getRangeByZoom(zoomKey: keyof typeof ZOOM_OPTIONS, today: Date) {
  if (zoomKey === "1m") {
    return {
      rangeStart: addDays(today, -7),
      rangeEnd: addDays(today, 21),
    };
  }

  if (zoomKey === "2m") {
    return {
      rangeStart: addDays(today, -14),
      rangeEnd: addDays(today, 42),
    };
  }

  if (zoomKey === "3m") {
    const rangeStart = addDays(today, -21);
    return {
      rangeStart,
      rangeEnd: addDays(addMonths(rangeStart, 3), -1),
    };
  }

  if (zoomKey === "6m") {
    const rangeStart = addDays(today, -42);
    return {
      rangeStart,
      rangeEnd: addDays(addMonths(rangeStart, 6), -1),
    };
  }

  return {
    rangeStart: addMonths(today, -4),
    rangeEnd: addDays(addMonths(today, 8), -1),
  };
}

export default async function PublicGanttPage({
  searchParams,
}: {
  searchParams: Promise<{
    zoom?: string | string[];
    anchor?: string | string[];
    taskId?: string | string[];
    create?: string | string[];
    createCollaborator?: string | string[];
    filters?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const requestedZoom = firstValue(resolvedSearchParams.zoom) ?? "1m";
  const requestedAnchor = firstValue(resolvedSearchParams.anchor) ?? "";
  const selectedTaskId = firstValue(resolvedSearchParams.taskId) ?? "";
  const createTaskModal = firstValue(resolvedSearchParams.create) === "1";
  const createCollaboratorModal = firstValue(resolvedSearchParams.createCollaborator) === "1";
  const filtersModal = firstValue(resolvedSearchParams.filters) === "1";
  const zoomKey = requestedZoom in ZOOM_OPTIONS ? (requestedZoom as keyof typeof ZOOM_OPTIONS) : "1m";
  const zoom = ZOOM_OPTIONS[zoomKey];
  const zoomIndex = ZOOM_SEQUENCE.indexOf(zoomKey);
  const zoomInKey = zoomIndex > 0 ? ZOOM_SEQUENCE[zoomIndex - 1] : null;
  const zoomOutKey = zoomIndex < ZOOM_SEQUENCE.length - 1 ? ZOOM_SEQUENCE[zoomIndex + 1] : null;

  const today = startOfDay(new Date());
  const parsedAnchorDate = parseDateParam(requestedAnchor);
  const anchorDate = parsedAnchorDate ?? today;
  const previousAnchor = shiftAnchorByZoom(anchorDate, zoomKey, -1);
  const nextAnchor = shiftAnchorByZoom(anchorDate, zoomKey, 1);

  const buildGanttHref = (
    nextZoom: keyof typeof ZOOM_OPTIONS,
    options?: { create?: boolean; createCollaborator?: boolean; filters?: boolean; anchorDate?: Date | null },
  ) => {
    const params = new URLSearchParams();
    params.set("zoom", nextZoom);
    const anchorForParams = options?.anchorDate ?? anchorDate;
    if (anchorForParams) {
      params.set("anchor", toDateParam(anchorForParams));
    }
    if (selectedTaskId) {
      params.set("taskId", selectedTaskId);
    }
    if (options?.create) {
      params.set("create", "1");
    }
    if (options?.createCollaborator) {
      params.set("createCollaborator", "1");
    }
    if (options?.filters) {
      params.set("filters", "1");
    }
    return `/public/gantt?${params.toString()}`;
  };

  const currentUser = await getCurrentUser();
  const isManager = currentUser?.role === "MANAGER";
  const viewerCompany = currentUser?.company?.trim() || null;
  const canCreateTasks = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const [activeClients, activeCompanies] = await Promise.all([
    prisma.client.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    prisma.company.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);
  const activeClientValues = activeClients.length > 0 ? activeClients.map((client) => client.name) : [...TASK_CLIENT_VALUES];
  const activeCompanyValues = activeCompanies.map((company) => company.name);

  const viewerAllowedClients = currentUser && currentUser.role !== "ADMIN"
    ? await prisma.userClientAccess.findMany({
        where: { userId: currentUser.id },
        select: { client: true },
      })
    : [];
  const allowedClientValues: string[] | null = currentUser && currentUser.role !== "ADMIN"
    ? viewerAllowedClients.map((entry) => entry.client).filter((client) => activeClientValues.includes(client))
    : null;
  const taskClientWhere = allowedClientValues
    ? { client: { in: allowedClientValues } }
    : {};
  const collaboratorWhere = currentUser?.role === "ADMIN"
    ? { role: { in: STAFF_ROLES }, isActive: true }
    : currentUser
      ? viewerCompany
        ? { role: { in: STAFF_ROLES }, isActive: true, company: viewerCompany }
        : { id: currentUser.id, role: { in: STAFF_ROLES }, isActive: true }
      : { role: Role.COLLABORATOR, isActive: true };

  const [collaborators, selectedTask] = await Promise.all([
    prisma.user.findMany({
      where: collaboratorWhere,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        company: true,
        dashboardTone: true,
        avatarPreset: true,
        visibleClients: {
          select: { client: true },
        },
        assignedTasks: {
          where: {
            status: {
              in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.ALMOST_DONE],
            },
            ...taskClientWhere,
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
                company: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);
  const selectedTaskAllowed = selectedTask
    ? !allowedClientValues || (selectedTask.client ? allowedClientValues.includes(selectedTask.client) : false)
    : false;
  const selectedTaskManageableByManager =
    isManager && viewerCompany && selectedTask?.assignee.company === viewerCompany;

  const { rangeStart, rangeEnd } = getRangeByZoom(zoomKey, anchorDate);

  const dayCount = Math.max(diffInDays(rangeStart, rangeEnd) + 1, 1);
  const days = Array.from({ length: dayCount }, (_, index) => addDays(rangeStart, index));
  const timelineWidth = TIMELINE_WIDTH;
  const weekHeaderGroups = buildWeekHeaderGroups(days, zoomKey);
  const monthGroups = buildMonthGroups(days);
  const showDailyLabels = zoomKey === "1m";

  const boardCollaborators = collaborators.map((collaborator) => {
    const avatar = getAvatarPreset(collaborator.avatarPreset);

    return {
      id: collaborator.id,
      name: collaborator.name,
      company: collaborator.company,
      dashboardTone: collaborator.dashboardTone,
      avatarEmoji: avatar.emoji,
      avatarSwatch: avatar.swatch,
      visibleClients: collaborator.visibleClients.map((entry) => entry.client),
      assignedTasks: collaborator.assignedTasks.map((task) => ({
        ...task,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        dueDate: task.dueDate?.toISOString() ?? null,
        expectedDoneAt: task.expectedDoneAt?.toISOString() ?? null,
      })),
    };
  }).filter((collaborator) => canCreateTasks || !allowedClientValues || collaborator.assignedTasks.length > 0);
  const availableCompanyValues = Array.from(
    new Set([
      ...activeCompanyValues,
      ...boardCollaborators
        .map((collaborator) => collaborator.company?.trim() || "")
        .filter((company) => company.length > 0),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <main className="min-h-screen bg-[#f4f6f8] px-4 py-5 text-slate-900">
      <div className="mx-auto w-full max-w-[1900px] space-y-3">
        <header className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-sky-600">People Gantt Publico</p>
              <h1 className="mt-1 bg-gradient-to-r from-slate-950 via-slate-900 to-sky-700 bg-clip-text text-[clamp(1.8rem,2.5vw,2.6rem)] font-semibold tracking-[-0.02em] text-transparent">
                Linea de tiempo del equipo
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/login"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-100"
              >
                Login
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.18)]">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div className="flex items-center gap-2">
              <p className="mr-1 text-xs uppercase tracking-[0.18em] text-slate-400">Zoom</p>
              {zoomInKey ? (
                <Link
                  href={buildGanttHref(zoomInKey)}
                  aria-label="Ampliar vista de tiempo"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-base text-slate-700 transition hover:bg-slate-100"
                >
                  +
                </Link>
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-base text-slate-300">
                  +
                </span>
              )}
              {zoomOutKey ? (
                <Link
                  href={buildGanttHref(zoomOutKey)}
                  aria-label="Reducir vista de tiempo"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-base text-slate-700 transition hover:bg-slate-100"
                >
                  -
                </Link>
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-base text-slate-300">
                  -
                </span>
              )}
              <Link
                href={buildGanttHref(zoomKey, { anchorDate: previousAnchor })}
                aria-label="Mover vista al periodo anterior"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-base text-slate-700 transition hover:bg-slate-100"
              >
                {"<"}
              </Link>
              <Link
                href={buildGanttHref(zoomKey, { anchorDate: nextAnchor })}
                aria-label="Mover vista al periodo siguiente"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-base text-slate-700 transition hover:bg-slate-100"
              >
                {">"}
              </Link>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
                {zoom.label}
              </span>
              <div id="gantt-toolbar-shortcuts" className="ml-1" />
            </div>
            <div className="flex items-center justify-center gap-2 md:col-start-2">
              <Link
                href={buildGanttHref(zoomKey, { filters: true })}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 fill-current text-slate-500">
                  <path d="M3.5 4a1 1 0 0 1 .8-.4h11.4a1 1 0 0 1 .77 1.64L12 10.62V15a1 1 0 0 1-.45.83l-2.5 1.67A1 1 0 0 1 7.5 16.67v-6.05L3.73 5.24A1 1 0 0 1 3.5 4Z" />
                </svg>
                Filtros
              </Link>
              {canCreateTasks ? (
                <>
                  {currentUser?.role === "ADMIN" ? (
                    <Link
                      href={buildGanttHref(zoomKey, { createCollaborator: true })}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 stroke-current text-slate-500">
                        <circle cx="8" cy="7" r="3" fill="none" strokeWidth="1.6" />
                        <path d="M3.5 16c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4" fill="none" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M14 6h3m-1.5-1.5v3" fill="none" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                      Nuevo colaborador
                    </Link>
                  ) : null}
                  <Link
                    href={buildGanttHref(zoomKey, { create: true })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 stroke-current text-white/90">
                      <rect x="3.5" y="4.5" width="13" height="11" rx="2" fill="none" strokeWidth="1.5" />
                      <path d="M10 7v6M7 10h6" fill="none" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Nueva tarea
                  </Link>
                </>
              ) : null}
            </div>
            <div className="flex min-h-7 items-center justify-end md:col-start-3">
              <div id="gantt-toolbar-status" />
            </div>
          </div>
        </section>

        <section
          data-gantt-scroll-container
          className="overflow-x-hidden rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.24)]"
        >
          <div>
            <div className="mb-3 flex items-end gap-3 border-b border-slate-200 pb-3">
              <div
                className="sticky left-0 z-30 shrink-0 bg-white"
                style={{ width: `${LABEL_WIDTH}px` }}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="grid border-b border-slate-200 pb-2"
                  style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
                >
                  {weekHeaderGroups.map((group) => (
                    <div
                      key={group.key}
                      className="flex h-2 items-center justify-center border-l border-slate-200 px-2 first:border-l-0"
                      style={{ gridColumn: `span ${group.span} / span ${group.span}` }}
                    >
                      <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[8px] font-medium uppercase leading-none tracking-[0.16em] text-slate-500">
                        {group.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  className="grid shrink-0 gap-0 pt-2"
                  style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
                >
                  {showDailyLabels
                    ? days.map((day) => (
                        <div
                          key={day.toISOString()}
                          className={cn(
                            "flex h-4 flex-col items-center justify-center border-l border-slate-200 px-1 text-center first:border-l-0",
                            isWeekend(day) ? "bg-slate-50/80" : "",
                          )}
                        >
                          <p className="whitespace-nowrap text-[8px] uppercase leading-none tracking-[0.14em] text-slate-400">{weekdayLabel(day)}</p>
                          <p className="mt-0.5 whitespace-nowrap text-[10px] font-medium leading-none text-slate-700">{rangeLabel(day)}</p>
                        </div>
                      ))
                    : monthGroups.map((group) => (
                        <div
                          key={`month-${group.key}`}
                          className="flex h-4 items-center justify-center border-l border-slate-200 px-2 first:border-l-0"
                          style={{ gridColumn: `span ${group.span} / span ${group.span}` }}
                        >
                          <span className="whitespace-nowrap text-[9px] font-medium uppercase leading-none tracking-[0.14em] text-slate-500">
                            {group.label}
                          </span>
                        </div>
                      ))}
                </div>
              </div>
            </div>

            <PublicGanttBoard
              key={`board-${zoomKey}-${selectedTaskId || "none"}`}
              collaborators={boardCollaborators}
              currentUserId={currentUser?.id}
              currentUserRole={currentUser?.role}
              selectedTaskId={selectedTaskId}
              zoomKey={zoomKey}
              dayCount={dayCount}
              rangeStartIso={rangeStart.toISOString()}
              rangeEndIso={rangeEnd.toISOString()}
              timelineWidth={timelineWidth}
              initialCreateModalOpen={createTaskModal}
              initialCreateCollaboratorModalOpen={createCollaboratorModal}
              initialFiltersModalOpen={filtersModal}
              allowedClientValues={allowedClientValues ?? activeClientValues}
              availableCompanyValues={availableCompanyValues}
            />

            {collaborators.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
                No hay colaboradores activos para mostrar en esta linea del tiempo.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {currentUser && selectedTask && selectedTaskAllowed && (currentUser.role === "ADMIN" || selectedTask.assigneeId === currentUser.id || selectedTaskManageableByManager) ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/28 px-4 py-8 backdrop-blur-[3px]">
          <Link
            href={buildGanttHref(zoomKey)}
            aria-label="Cerrar editor"
            className="absolute inset-0"
          />
          <div className="relative z-10 mx-auto flex min-h-full w-full max-w-5xl items-center">
            <GanttTaskEditor
              currentUser={currentUser}
              task={selectedTask}
              collaborators={boardCollaborators.map((collaborator) => ({ id: collaborator.id, name: collaborator.name }))}
              zoomKey={zoomKey}
              availableClientValues={activeClientValues}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
