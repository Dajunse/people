import Link from "next/link";
import { Role, TaskClient, TaskStatus } from "@prisma/client";
import { GanttTaskEditor } from "@/components/gantt-task-editor";
import { PublicGanttBoard } from "@/components/public-gantt-board";
import { getAvatarPreset } from "@/lib/avatar-presets";
import { getCurrentUser } from "@/lib/auth";
import {
  LABEL_WIDTH,
  ZOOM_OPTIONS,
  addDays,
  diffInDays,
  firstValue,
  getIsoWeekInfo,
  getTaskSchedule,
  isWeekend,
  rangeLabel,
  startOfDay,
  weekdayLabel,
} from "@/lib/gantt";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";

export const dynamic = "force-dynamic";

const ZOOM_SEQUENCE = ["1w", "2w", "3w", "1m", "2m", "3m", "4m", "5m", "6m"] as const;
const STAFF_ROLES: Role[] = [Role.COLLABORATOR, Role.MANAGER];

export default async function PublicGanttPage({
  searchParams,
}: {
  searchParams: Promise<{
    zoom?: string | string[];
    taskId?: string | string[];
    create?: string | string[];
    createCollaborator?: string | string[];
    filters?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const requestedZoom = firstValue(resolvedSearchParams.zoom) ?? "3w";
  const selectedTaskId = firstValue(resolvedSearchParams.taskId) ?? "";
  const createTaskModal = firstValue(resolvedSearchParams.create) === "1";
  const createCollaboratorModal = firstValue(resolvedSearchParams.createCollaborator) === "1";
  const filtersModal = firstValue(resolvedSearchParams.filters) === "1";
  const zoomKey = requestedZoom in ZOOM_OPTIONS ? (requestedZoom as keyof typeof ZOOM_OPTIONS) : "3w";
  const zoom = ZOOM_OPTIONS[zoomKey];
  const zoomIndex = ZOOM_SEQUENCE.indexOf(zoomKey);
  const zoomInKey = zoomIndex > 0 ? ZOOM_SEQUENCE[zoomIndex - 1] : null;
  const zoomOutKey = zoomIndex < ZOOM_SEQUENCE.length - 1 ? ZOOM_SEQUENCE[zoomIndex + 1] : null;

  const buildGanttHref = (
    nextZoom: keyof typeof ZOOM_OPTIONS,
    options?: { create?: boolean; createCollaborator?: boolean; filters?: boolean },
  ) => {
    const params = new URLSearchParams();
    params.set("zoom", nextZoom);
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
  const canCreateTasks = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const viewerAllowedClients = currentUser && currentUser.role !== "ADMIN"
    ? await prisma.userClientAccess.findMany({
        where: { userId: currentUser.id },
        select: { client: true },
      })
    : [];
  const allowedClientValues: TaskClient[] | null = currentUser && currentUser.role !== "ADMIN"
    ? viewerAllowedClients.map((entry) => entry.client as TaskClient)
    : null;
  const taskClientWhere = allowedClientValues
    ? { client: { in: allowedClientValues } }
    : {};
  const collaboratorWhere = currentUser?.role === "ADMIN"
    ? { role: { in: STAFF_ROLES }, isActive: true }
    : currentUser?.role === "MANAGER" && currentUser.primaryClient
      ? { role: { in: STAFF_ROLES }, isActive: true, primaryClient: currentUser.primaryClient }
      : { role: Role.COLLABORATOR, isActive: true };

  const [collaborators, selectedTask] = await Promise.all([
    prisma.user.findMany({
      where: collaboratorWhere,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        primaryClient: true,
        dashboardTone: true,
        avatarPreset: true,
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
                primaryClient: true,
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
    isManager && currentUser?.primaryClient && selectedTask?.assignee.primaryClient === currentUser.primaryClient;

  const scheduledEntries = collaborators.flatMap((collaborator) =>
    collaborator.assignedTasks
      .map((task) => {
        const schedule = getTaskSchedule(task);
        if (!schedule) {
          return null;
        }
        return { schedule };
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

  const boardCollaborators = collaborators.map((collaborator) => {
    const avatar = getAvatarPreset(collaborator.avatarPreset);

    return {
      id: collaborator.id,
      name: collaborator.name,
      dashboardTone: collaborator.dashboardTone,
      avatarEmoji: avatar.emoji,
      avatarSwatch: avatar.swatch,
      assignedTasks: collaborator.assignedTasks.map((task) => ({
        ...task,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        dueDate: task.dueDate?.toISOString() ?? null,
        expectedDoneAt: task.expectedDoneAt?.toISOString() ?? null,
      })),
    };
  }).filter((collaborator) => canCreateTasks || !allowedClientValues || collaborator.assignedTasks.length > 0);

  return (
    <main className="min-h-screen bg-[#f4f6f8] px-6 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-[1900px] space-y-5">
        <header className="rounded-[32px] border border-slate-200 bg-white px-6 py-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Linea de tiempo del equipo</h1>
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
        </header>

        <section className="rounded-[32px] border border-slate-200 bg-white p-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.18)]">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div className="flex items-center gap-2">
              <p className="mr-1 text-xs uppercase tracking-[0.18em] text-slate-400">Zoom</p>
              {zoomInKey ? (
                <Link
                  href={buildGanttHref(zoomInKey)}
                  aria-label="Ampliar vista de tiempo"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg text-slate-700 transition hover:bg-slate-100"
                >
                  +
                </Link>
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg text-slate-300">
                  +
                </span>
              )}
              {zoomOutKey ? (
                <Link
                  href={buildGanttHref(zoomOutKey)}
                  aria-label="Reducir vista de tiempo"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg text-slate-700 transition hover:bg-slate-100"
                >
                  -
                </Link>
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg text-slate-300">
                  -
                </span>
              )}
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
                {zoom.label}
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 md:col-start-2">
              <Link
                href={buildGanttHref(zoomKey, { filters: true })}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Filtros
              </Link>
              {canCreateTasks ? (
                <>
                  {currentUser?.role === "ADMIN" ? (
                    <Link
                      href={buildGanttHref(zoomKey, { createCollaborator: true })}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Nuevo colaborador
                    </Link>
                  ) : null}
                  <Link
                    href={buildGanttHref(zoomKey, { create: true })}
                    className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Nueva tarea
                  </Link>
                </>
              ) : null}
            </div>
            <div className="hidden md:block" />
          </div>
        </section>

        <section className="overflow-x-auto rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.24)]">
          <div style={{ minWidth: `${timelineWidth + LABEL_WIDTH + 24}px` }}>
            <div className="mb-4 flex items-end gap-4 border-b border-slate-200 pb-4">
              <div className="shrink-0" style={{ width: `${LABEL_WIDTH}px` }} />
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

            <PublicGanttBoard
              key={`board-${zoomKey}-${selectedTaskId || "none"}-${createTaskModal ? "create" : "normal"}-${createCollaboratorModal ? "create-collaborator" : "normal-collaborator"}-${filtersModal ? "filters" : "no-filters"}`}
              collaborators={boardCollaborators}
              currentUserId={currentUser?.id}
              currentUserRole={currentUser?.role}
              selectedTaskId={selectedTaskId}
              zoomKey={zoomKey}
              dayWidth={zoom.dayWidth}
              dayCount={dayCount}
              rangeStartIso={rangeStart.toISOString()}
              rangeEndIso={rangeEnd.toISOString()}
              timelineWidth={timelineWidth}
              initialCreateModalOpen={createTaskModal}
              initialCreateCollaboratorModalOpen={createCollaboratorModal}
              initialFiltersModalOpen={filtersModal}
              allowedClientValues={allowedClientValues ?? [...TASK_CLIENT_VALUES]}
            />

            {collaborators.length === 0 ? (
              <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No hay colaboradores activos para mostrar en esta linea del tiempo.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {currentUser && selectedTask && selectedTaskAllowed && (currentUser.role === "ADMIN" || selectedTask.assigneeId === currentUser.id || selectedTaskManageableByManager) ? (
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
              collaborators={boardCollaborators.map((collaborator) => ({ id: collaborator.id, name: collaborator.name }))}
              zoomKey={zoomKey}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
