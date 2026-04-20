"use client";

import { TaskClient, TaskStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  createCollaboratorFromGanttAction,
  createTaskFromGanttAction,
  shiftTaskScheduleAction,
} from "@/actions/gantt-actions";
import { taskClientLabel } from "@/lib/labels";
import {
  BAR_HEIGHT,
  LABEL_WIDTH,
  LANE_HEIGHT,
  addDays,
  assignLanes,
  diffInDays,
  getBarSwatch,
  getClientTone,
  getTaskSchedule,
  getTaskTone,
  isWeekend,
  startOfDay,
} from "@/lib/gantt";
import { cn, formatDate } from "@/lib/utils";

type GanttTask = {
  id: string;
  title: string;
  description: string | null;
  client: TaskClient | null;
  status: TaskStatus;
  assigneeId: string;
  createdAt: string;
  startedAt: string | null;
  dueDate: string | null;
  expectedDoneAt: string | null;
};

type GanttCollaborator = {
  id: string;
  name: string;
  dashboardTone: string | null;
  avatarEmoji: string;
  avatarSwatch: string;
  assignedTasks: GanttTask[];
};

type TaskOverride = {
  startedAt: string;
  dueDate: string;
};

type DragState = {
  taskId: string;
  originX: number;
  start: Date;
  end: Date;
  dayDelta: number;
  hasMoved: boolean;
  assigneeId: string;
  targetAssigneeId: string;
};

function parseTaskSchedule(task: GanttTask, override?: TaskOverride) {
  return getTaskSchedule({
    createdAt: new Date(task.createdAt),
    startedAt: override?.startedAt ? new Date(override.startedAt) : task.startedAt ? new Date(task.startedAt) : null,
    dueDate: override?.dueDate ? new Date(override.dueDate) : task.dueDate ? new Date(task.dueDate) : null,
    expectedDoneAt: task.expectedDoneAt ? new Date(task.expectedDoneAt) : null,
  });
}

function statusLabelFor(status: TaskStatus) {
  if (status === TaskStatus.PENDING) return "Pendiente";
  if (status === TaskStatus.IN_PROGRESS) return "En progreso";
  if (status === TaskStatus.ALMOST_DONE) return "Casi lista";
  return "Completada";
}

const NO_CLIENT_KEY = "__NO_CLIENT__";
const COLLABORATOR_FILTERS_STORAGE_KEY = "people_gantt_filters_collaborators";
const CLIENT_FILTERS_STORAGE_KEY = "people_gantt_filters_clients";
const DRAG_ACTIVATION_PX = 4;

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromInputDate(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function nextBusinessDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  while (isWeekend(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function addBusinessDaysInclusive(date: Date, totalBusinessDays: number) {
  const safeTotal = Math.max(totalBusinessDays, 1);
  const next = nextBusinessDay(date);
  let remaining = safeTotal - 1;

  while (remaining > 0) {
    next.setDate(next.getDate() + 1);
    if (!isWeekend(next)) {
      remaining -= 1;
    }
  }

  return next;
}

function getDefaultTaskDates() {
  const start = new Date();
  const end = addBusinessDaysInclusive(start, 5);
  return {
    startDate: toInputDate(start),
    dueDate: toInputDate(end),
  };
}

export function PublicGanttBoard({
  collaborators,
  currentUserId,
  currentUserRole,
  selectedTaskId,
  zoomKey,
  dayWidth,
  dayCount,
  rangeStartIso,
  rangeEndIso,
  timelineWidth,
  initialCreateModalOpen,
  initialCreateCollaboratorModalOpen,
  initialFiltersModalOpen,
  allowedClientValues,
}: {
  collaborators: GanttCollaborator[];
  currentUserId?: string;
  currentUserRole?: string;
  selectedTaskId: string;
  zoomKey: string;
  dayWidth: number;
  dayCount: number;
  rangeStartIso: string;
  rangeEndIso: string;
  timelineWidth: number;
  initialCreateModalOpen?: boolean;
  initialCreateCollaboratorModalOpen?: boolean;
  initialFiltersModalOpen?: boolean;
  allowedClientValues: TaskClient[];
}) {
  const router = useRouter();
  const canPlan = currentUserRole === "ADMIN";
  const canViewNoClientOption = canPlan;
  const collaboratorIds = collaborators.map((collaborator) => collaborator.id);
  const availableClientValues = allowedClientValues;
  const validClientKeys = canViewNoClientOption
    ? [...availableClientValues, NO_CLIENT_KEY]
    : [...availableClientValues];
  const [overrides, setOverrides] = useState<Record<string, TaskOverride>>({});
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [hoverAssigneeId, setHoverAssigneeId] = useState<string | null>(null);
  const [dragMessage, setDragMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(Boolean(initialCreateModalOpen));
  const [isCreateCollaboratorModalOpen, setIsCreateCollaboratorModalOpen] = useState(
    Boolean(initialCreateCollaboratorModalOpen),
  );
  const [isFiltersModalOpen, setIsFiltersModalOpen] = useState(Boolean(initialFiltersModalOpen));
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskClient, setNewTaskClient] = useState<TaskClient>(availableClientValues[0] ?? "SCIO");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState(collaborators[0]?.id ?? "");
  const [newTaskStartDate, setNewTaskStartDate] = useState(() => getDefaultTaskDates().startDate);
  const [newTaskDueDate, setNewTaskDueDate] = useState(() => getDefaultTaskDates().dueDate);
  const [newCollaboratorName, setNewCollaboratorName] = useState("");
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState("");
  const [newCollaboratorPassword, setNewCollaboratorPassword] = useState("");
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return collaboratorIds;
    try {
      const raw = window.localStorage.getItem(COLLABORATOR_FILTERS_STORAGE_KEY);
      if (!raw) return collaboratorIds;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return collaboratorIds;
      return parsed.filter((id): id is string => typeof id === "string");
    } catch {
      return collaboratorIds;
    }
  });
  const [selectedClients, setSelectedClients] = useState<string[]>(() => {
    if (typeof window === "undefined") return validClientKeys;
    try {
      const raw = window.localStorage.getItem(CLIENT_FILTERS_STORAGE_KEY);
      if (!raw) return validClientKeys;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return validClientKeys;
      return parsed.filter((key): key is string => typeof key === "string");
    } catch {
      return validClientKeys;
    }
  });
  const [isPending, startTransition] = useTransition();
  const dragRef = useRef<DragState | null>(null);
  const dragChangedTaskRef = useRef<string | null>(null);
  const today = startOfDay(new Date());
  const rangeStart = new Date(rangeStartIso);
  const rangeEnd = new Date(rangeEndIso);
  const openTask = (taskId: string) => {
    if (dragChangedTaskRef.current === taskId) {
      dragChangedTaskRef.current = null;
      return;
    }
    router.push(`/public/gantt?zoom=${zoomKey}&taskId=${taskId}`, { scroll: false });
  };

  const resolveCollaboratorIdFromPoint = (clientX: number, clientY: number) => {
    if (typeof document === "undefined") return null;
    const node = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    return node?.closest<HTMLElement>("[data-gantt-collaborator-id]")?.dataset.ganttCollaboratorId ?? null;
  };

  async function persistShift(
    taskId: string,
    start: Date,
    end: Date,
    previousOverride?: TaskOverride,
    assigneeId?: string,
  ) {
    startTransition(async () => {
      try {
        await shiftTaskScheduleAction({
          taskId,
          startedAt: start.toISOString(),
          dueDate: end.toISOString(),
          assigneeId,
        });
        setDragMessage({ type: "success", text: "Tarea actualizada correctamente." });
        router.refresh();
      } catch {
        setDragMessage({ type: "error", text: "No se pudo guardar el cambio. Se restauro la fecha anterior." });
        if (previousOverride) {
          setOverrides((current) => ({ ...current, [taskId]: previousOverride }));
        } else {
          setOverrides((current) => {
            const next = { ...current };
            delete next[taskId];
            return next;
          });
        }
      }
    });
  }

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    const params = new URLSearchParams();
    params.set("zoom", zoomKey);
    if (selectedTaskId) {
      params.set("taskId", selectedTaskId);
    }
    router.push(`/public/gantt?${params.toString()}`, { scroll: false });
  };

  const closeCreateCollaboratorModal = () => {
    setIsCreateCollaboratorModalOpen(false);
    const params = new URLSearchParams();
    params.set("zoom", zoomKey);
    if (selectedTaskId) {
      params.set("taskId", selectedTaskId);
    }
    router.push(`/public/gantt?${params.toString()}`, { scroll: false });
  };

  const closeFiltersModal = () => {
    setIsFiltersModalOpen(false);
    const params = new URLSearchParams();
    params.set("zoom", zoomKey);
    if (selectedTaskId) {
      params.set("taskId", selectedTaskId);
    }
    router.push(`/public/gantt?${params.toString()}`, { scroll: false });
  };

  const toggleCollaboratorFilter = (collaboratorId: string) => {
    setSelectedCollaboratorIds((current) => {
      const next = current.includes(collaboratorId)
        ? current.filter((id) => id !== collaboratorId)
        : [...current, collaboratorId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(COLLABORATOR_FILTERS_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const toggleClientFilter = (clientKey: string) => {
    setSelectedClients((current) => {
      const next = current.includes(clientKey) ? current.filter((key) => key !== clientKey) : [...current, clientKey];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CLIENT_FILTERS_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const activeCollaboratorFilter = selectedCollaboratorIds.filter((id) => collaboratorIds.includes(id));
  const activeClientFilter = selectedClients.filter((key) => validClientKeys.includes(key));

  const handleCreateTask = () => {
    if (!canPlan) return;

    const cleanTitle = newTaskTitle.trim();
    if (cleanTitle.length < 2) {
      setDragMessage({ type: "error", text: "El titulo debe tener al menos 2 caracteres." });
      return;
    }
    if (!newTaskAssigneeId) {
      setDragMessage({ type: "error", text: "Selecciona un colaborador para asignar la tarea." });
      return;
    }
    if (!newTaskStartDate || !newTaskDueDate) {
      setDragMessage({ type: "error", text: "Selecciona fecha de inicio y fecha fin." });
      return;
    }

    const startDate = fromInputDate(newTaskStartDate);
    const dueDate = fromInputDate(newTaskDueDate);
    if (dueDate.getTime() < startDate.getTime()) {
      setDragMessage({ type: "error", text: "La fecha fin no puede ser menor a la fecha inicio." });
      return;
    }

    setDragMessage(null);

    startTransition(async () => {
      try {
        await createTaskFromGanttAction({
          title: cleanTitle,
          client: newTaskClient,
          assigneeId: newTaskAssigneeId,
          startedAt: newTaskStartDate,
          dueDate: newTaskDueDate,
        });
        const defaults = getDefaultTaskDates();
        setNewTaskTitle("");
        setNewTaskClient(availableClientValues[0] ?? "SCIO");
        setNewTaskStartDate(defaults.startDate);
        setNewTaskDueDate(defaults.dueDate);
        closeCreateModal();
        setDragMessage({ type: "success", text: "Tarea creada correctamente." });
        router.refresh();
      } catch {
        setDragMessage({
          type: "error",
          text: "No se pudo crear la tarea. Intenta de nuevo.",
        });
      }
    });
  };

  const handleCreateCollaborator = () => {
    if (!canPlan) return;

    const cleanName = newCollaboratorName.trim();
    const cleanEmail = newCollaboratorEmail.trim().toLowerCase();
    if (cleanName.length < 2) {
      setDragMessage({ type: "error", text: "El nombre debe tener al menos 2 caracteres." });
      return;
    }
    if (!cleanEmail) {
      setDragMessage({ type: "error", text: "Ingresa un correo valido." });
      return;
    }
    if (newCollaboratorPassword.length < 8) {
      setDragMessage({ type: "error", text: "La contrasena debe tener al menos 8 caracteres." });
      return;
    }

    setDragMessage(null);

    startTransition(async () => {
      try {
        await createCollaboratorFromGanttAction({
          name: cleanName,
          email: cleanEmail,
          password: newCollaboratorPassword,
        });
        setNewCollaboratorName("");
        setNewCollaboratorEmail("");
        setNewCollaboratorPassword("");
        closeCreateCollaboratorModal();
        setDragMessage({ type: "success", text: "Colaborador creado correctamente." });
        router.refresh();
      } catch {
        setDragMessage({
          type: "error",
          text: "No se pudo crear el colaborador. Verifica los datos.",
        });
      }
    });
  };

  const visibleCollaborators = collaborators
    .filter((collaborator) => activeCollaboratorFilter.includes(collaborator.id))
    .map((collaborator) => ({
      ...collaborator,
      assignedTasks: collaborator.assignedTasks.filter((task) => {
        if (!task.client) {
          return activeClientFilter.includes(NO_CLIENT_KEY);
        }
        return activeClientFilter.includes(task.client);
      }),
    }));

  return (
    <div className="space-y-3">
      {dragMessage ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {isPending ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Guardando cambios...</span>
          ) : null}
          <span
            className={cn(
              "rounded-full border px-3 py-1",
              dragMessage.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            {dragMessage.text}
          </span>
        </div>
      ) : null}
      {visibleCollaborators.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No hay resultados con los filtros seleccionados.
        </div>
      ) : null}
      {visibleCollaborators.map((collaborator) => {
        const barSwatch = getBarSwatch(collaborator.dashboardTone);
        const canOpenModal = currentUserId ? currentUserRole === "ADMIN" || currentUserId === collaborator.id : false;
        const taskEntries = collaborator.assignedTasks.flatMap((task) => {
          const schedule = parseTaskSchedule(task, overrides[task.id]);
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
                <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br text-2xl shadow-sm ${collaborator.avatarSwatch}`}>
                  {collaborator.avatarEmoji}
                </span>
                <div>
                  <p className="text-lg font-semibold text-slate-900">{collaborator.name}</p>
                </div>
              </div>
            </div>

            <div
              data-gantt-collaborator-id={collaborator.id}
              className={cn(
                "relative shrink-0 overflow-visible rounded-[28px] border border-slate-200 bg-slate-50",
                activeDragId && hoverAssigneeId === collaborator.id ? "ring-2 ring-slate-300/80 ring-offset-2" : "",
              )}
              style={{ width: `${timelineWidth}px`, height: `${rowHeight}px` }}
            >
              <div
                className="grid h-full"
                style={{
                  gridTemplateColumns: `repeat(${dayCount}, ${dayWidth}px)`,
                  gridTemplateRows: `repeat(${laneCount}, ${LANE_HEIGHT}px)`,
                }}
              >
                {Array.from({ length: laneCount }).map((_, laneIndex) =>
                  Array.from({ length: dayCount }).map((__, dayIndex) => {
                    const day = addDays(rangeStart, dayIndex);
                    return (
                      <div
                        key={`${collaborator.id}-${laneIndex}-${day.toISOString()}`}
                        className={cn(
                          "border-l border-t border-slate-200 first:border-l-0",
                          isWeekend(day) ? "bg-slate-100/60" : "bg-white/55",
                        )}
                      />
                    );
                  }),
                )}
              </div>

              {today.getTime() >= rangeStart.getTime() && today.getTime() <= rangeEnd.getTime() ? (
                <div
                  className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-slate-950/75"
                  style={{ left: `${diffInDays(rangeStart, today) * dayWidth + dayWidth / 2}px` }}
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
                  const left = visibleStartOffset * dayWidth + 8;
                  const width = Math.max((visibleEndOffset - visibleStartOffset + 1) * dayWidth - 14, 32);
                  const top = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;
                  const tone = getTaskTone(task, schedule, today);
                  const clientTone = getClientTone(task.client);
                  const isEditableTask = Boolean(canOpenModal);
                  const isDragging = activeDragId === task.id;
                  const sharedClassName = `group absolute rounded-[20px] border bg-gradient-to-r px-3 py-3 shadow-[0_12px_30px_-16px_rgba(15,23,42,0.85)] transition hover:z-20 hover:shadow-[0_24px_45px_-20px_rgba(15,23,42,0.45)] ${barSwatch} ${tone.barClassName} ${selectedTaskId === task.id ? "ring-2 ring-slate-950/20" : ""} ${isDragging ? "z-30 shadow-[0_28px_55px_-22px_rgba(15,23,42,0.55)]" : ""}`;
                  const sharedStyle = {
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    minHeight: `${BAR_HEIGHT}px`,
                  };
                  const barContent = (
                    <div className="min-w-0 pr-8">
                        <div className="flex items-center gap-2">
                          <p className={`truncate text-sm font-semibold ${tone.textClassName}`}>{task.title}</p>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${clientTone}`}>
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
                            Estado: {statusLabelFor(task.status)}
                          </span>
                          <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                            Inicio: {formatDate(schedule.start)}
                          </span>
                          <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                            Fin: {formatDate(schedule.end)}
                          </span>
                          <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                            Cliente: {taskClientLabel(task.client)}
                          </span>
                          {canPlan ? (
                            <span className="rounded-full border border-white/25 bg-black/10 px-2 py-0.5">
                              {isDragging ? "Replaneando..." : "Arrastra la barra para mover"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );

                  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
                    if (!canPlan) return;

                    event.preventDefault();
                    event.stopPropagation();
                    setDragMessage(null);
                    dragChangedTaskRef.current = null;

                    dragRef.current = {
                      taskId: task.id,
                      originX: event.clientX,
                      start: schedule.start,
                      end: schedule.end,
                      dayDelta: 0,
                      hasMoved: false,
                      assigneeId: collaborator.id,
                      targetAssigneeId: collaborator.id,
                    };
                    setActiveDragId(task.id);
                    setHoverAssigneeId(collaborator.id);
                    event.currentTarget.setPointerCapture(event.pointerId);
                  };

                  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
                    const drag = dragRef.current;
                    if (!drag || drag.taskId !== task.id) return;

                    const pixelDelta = event.clientX - drag.originX;
                    if (!drag.hasMoved && Math.abs(pixelDelta) >= DRAG_ACTIVATION_PX) {
                      drag.hasMoved = true;
                      dragChangedTaskRef.current = task.id;
                    }

                    const hoveredAssigneeId = resolveCollaboratorIdFromPoint(event.clientX, event.clientY);
                    if (hoveredAssigneeId && hoveredAssigneeId !== drag.targetAssigneeId) {
                      drag.targetAssigneeId = hoveredAssigneeId;
                      setHoverAssigneeId(hoveredAssigneeId);
                      dragChangedTaskRef.current = task.id;
                    }

                    const nextDayDelta = Math.round(pixelDelta / dayWidth);
                    if (nextDayDelta === drag.dayDelta) return;

                    drag.dayDelta = nextDayDelta;
                    const nextStart = addDays(drag.start, nextDayDelta);
                    const nextEnd = addDays(drag.end, nextDayDelta);
                    dragChangedTaskRef.current = task.id;
                    setOverrides((current) => ({
                      ...current,
                      [task.id]: {
                        startedAt: nextStart.toISOString(),
                        dueDate: nextEnd.toISOString(),
                      },
                    }));
                  };

                  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
                    const drag = dragRef.current;
                    if (!drag || drag.taskId !== task.id) return;

                    event.currentTarget.releasePointerCapture(event.pointerId);
                    dragRef.current = null;
                    setActiveDragId(null);
                    setHoverAssigneeId(null);
                    const assigneeChanged = drag.targetAssigneeId !== drag.assigneeId;
                    const wasClick = !drag.hasMoved && !assigneeChanged;

                    if (wasClick) {
                      openTask(task.id);
                      return;
                    }

                    if (drag.dayDelta === 0 && !assigneeChanged) {
                      dragChangedTaskRef.current = null;
                      setOverrides((current) => {
                        const next = { ...current };
                        delete next[task.id];
                        return next;
                      });
                      return;
                    }

                    const previousOverride = overrides[task.id];
                    const nextStart = addDays(drag.start, drag.dayDelta);
                    const nextEnd = addDays(drag.end, drag.dayDelta);
                    persistShift(
                      task.id,
                      nextStart,
                      nextEnd,
                      previousOverride,
                      assigneeChanged ? drag.targetAssigneeId : undefined,
                    );
                  };

                  const handlePointerCancel = () => {
                    dragChangedTaskRef.current = null;
                    setHoverAssigneeId(null);
                    setOverrides((current) => {
                      const next = { ...current };
                      delete next[task.id];
                      return next;
                    });
                    dragRef.current = null;
                    setActiveDragId(null);
                  };

                  if (isEditableTask) {
                    if (canPlan) {
                      return (
                        <div
                          key={task.id}
                          className={`${sharedClassName} touch-none ${isPending && activeDragId === task.id ? "pointer-events-none opacity-80" : "cursor-grab active:cursor-grabbing"}`}
                          style={sharedStyle}
                          onPointerDown={handlePointerDown}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                          onPointerCancel={handlePointerCancel}
                        >
                          {barContent}
                        </div>
                      );
                    }

                    return (
                      <div key={task.id} className={sharedClassName} style={sharedStyle}>
                        <button
                          type="button"
                          className="absolute inset-0 z-10 rounded-[20px] text-left"
                          onClick={() => openTask(task.id)}
                          aria-label={`Abrir tarea ${task.title}`}
                        >
                          <span className="sr-only">Abrir tarea</span>
                        </button>
                        {barContent}
                      </div>
                    );
                  }

                  return (
                    <div key={task.id} className={sharedClassName} style={sharedStyle}>
                      {barContent}
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

      {canPlan && isCreateModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 px-4">
          <button
            type="button"
            aria-label="Cerrar modal de nueva tarea"
            className="absolute inset-0"
            onClick={closeCreateModal}
          />
          <section className="relative z-10 w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Gantt Publico</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Nueva tarea</h3>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm text-slate-700">Titulo</label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="Ej. Seguimiento de propuesta"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-slate-700">Cliente</label>
                  <select
                    value={newTaskClient}
                    onChange={(event) => setNewTaskClient(event.target.value as TaskClient)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                  {availableClientValues.map((client) => (
                    <option key={client} value={client}>
                      {taskClientLabel(client)}
                    </option>
                  ))}
                </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-700">Asignar a</label>
                  <select
                    value={newTaskAssigneeId}
                    onChange={(event) => setNewTaskAssigneeId(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {collaborators.map((collaborator) => (
                      <option key={collaborator.id} value={collaborator.id}>
                        {collaborator.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-slate-700">Fecha inicio</label>
                  <input
                    type="date"
                    value={newTaskStartDate}
                    onChange={(event) => {
                      const nextStartDate = event.target.value;
                      setNewTaskStartDate(nextStartDate);
                      if (newTaskDueDate && fromInputDate(newTaskDueDate).getTime() < fromInputDate(nextStartDate).getTime()) {
                        setNewTaskDueDate(nextStartDate);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-700">Fecha fin</label>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(event) => setNewTaskDueDate(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateTask}
                disabled={isPending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isPending ? "Creando..." : "Crear tarea"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {canPlan && isCreateCollaboratorModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 px-4">
          <button
            type="button"
            aria-label="Cerrar modal de nuevo colaborador"
            className="absolute inset-0"
            onClick={closeCreateCollaboratorModal}
          />
          <section className="relative z-10 w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Gantt Publico</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Nuevo colaborador</h3>
              </div>
              <button
                type="button"
                onClick={closeCreateCollaboratorModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm text-slate-700">Nombre</label>
                <input
                  type="text"
                  value={newCollaboratorName}
                  onChange={(event) => setNewCollaboratorName(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="Ej. Ana Perez"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-700">Correo</label>
                <input
                  type="email"
                  value={newCollaboratorEmail}
                  onChange={(event) => setNewCollaboratorEmail(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="ana@empresa.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-700">Contrasena temporal</label>
                <input
                  type="password"
                  value={newCollaboratorPassword}
                  onChange={(event) => setNewCollaboratorPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="Minimo 8 caracteres"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateCollaboratorModal}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateCollaborator}
                disabled={isPending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isPending ? "Creando..." : "Crear colaborador"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isFiltersModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 px-4">
          <button
            type="button"
            aria-label="Cerrar modal de filtros"
            className="absolute inset-0"
            onClick={closeFiltersModal}
          />
          <section className="relative z-10 w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Vista Gantt</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">Filtros</h3>
              </div>
              <button
                type="button"
                onClick={closeFiltersModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">Colaboradores</p>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCollaboratorIds(collaboratorIds);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(
                            COLLABORATOR_FILTERS_STORAGE_KEY,
                            JSON.stringify(collaboratorIds),
                          );
                        }
                      }}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCollaboratorIds([]);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(COLLABORATOR_FILTERS_STORAGE_KEY, JSON.stringify([]));
                        }
                      }}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {collaborators.map((collaborator) => (
                    <label key={collaborator.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={activeCollaboratorFilter.includes(collaborator.id)}
                        onChange={() => toggleCollaboratorFilter(collaborator.id)}
                      />
                      <span>{collaborator.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">Empresas</p>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClients(validClientKeys);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(CLIENT_FILTERS_STORAGE_KEY, JSON.stringify(validClientKeys));
                        }
                      }}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClients([]);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(CLIENT_FILTERS_STORAGE_KEY, JSON.stringify([]));
                        }
                      }}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      Ninguna
                    </button>
                  </div>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {availableClientValues.map((client) => (
                    <label key={client} className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={activeClientFilter.includes(client)}
                        onChange={() => toggleClientFilter(client)}
                      />
                      <span>{taskClientLabel(client)}</span>
                    </label>
                  ))}
                  {canViewNoClientOption ? (
                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={activeClientFilter.includes(NO_CLIENT_KEY)}
                        onChange={() => toggleClientFilter(NO_CLIENT_KEY)}
                      />
                      <span>Sin cliente</span>
                    </label>
                  ) : null}
                </div>
              </div>
            </div>

          </section>
        </div>
      ) : null}
    </div>
  );
}
