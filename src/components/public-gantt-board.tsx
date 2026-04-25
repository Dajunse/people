"use client";

import { TaskStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
  addMonths,
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
  client: string | null;
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
  company: string | null;
  dashboardTone: string | null;
  avatarEmoji: string;
  avatarSwatch: string;
  visibleClients: string[];
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

function getCompanyHeaderTone(company: string | null | undefined) {
  const normalized = company?.trim() ?? "";
  if (!normalized) {
    return {
      leftStyle: { backgroundColor: "hsl(216 16% 84%)" },
      rightStyle: { backgroundColor: "hsl(216 14% 88%)" },
      textClassName: "text-slate-700",
    };
  }

  return {
    leftStyle: { backgroundColor: "hsl(210 78% 90%)" },
    rightStyle: { backgroundColor: "hsl(210 74% 94%)" },
    textClassName: "text-slate-700",
  };
}

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
const NO_COMPANY_KEY = "__NO_COMPANY__";
const COLLABORATOR_FILTERS_STORAGE_KEY = "people_gantt_filters_collaborators";
const CLIENT_FILTERS_STORAGE_KEY = "people_gantt_filters_clients";
const COMPANY_FILTERS_STORAGE_KEY = "people_gantt_filters_companies";
const KEYBOARD_SHORTCUTS_STORAGE_KEY = "people_gantt_keyboard_shortcuts_enabled";
const DRAG_ACTIVATION_PX = 4;
const ZOOM_SEQUENCE = ["1m", "2m", "3m", "6m", "1y"] as const;

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

function shiftAnchorByZoom(anchorDate: Date, zoom: (typeof ZOOM_SEQUENCE)[number], direction: -1 | 1) {
  if (zoom === "1m") {
    return addDays(anchorDate, 7 * direction);
  }
  if (zoom === "2m") {
    return addDays(anchorDate, 14 * direction);
  }
  if (zoom === "3m") {
    return addDays(anchorDate, 21 * direction);
  }
  if (zoom === "6m") {
    return addMonths(anchorDate, direction);
  }
  return addMonths(anchorDate, 2 * direction);
}

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

function clampDayIndex(value: number, maxDayIndex: number) {
  return Math.max(0, Math.min(value, maxDayIndex));
}

export function PublicGanttBoard({
  collaborators,
  currentUserId,
  currentUserRole,
  selectedTaskId,
  zoomKey,
  dayCount,
  rangeStartIso,
  rangeEndIso,
  timelineWidth,
  initialCreateModalOpen,
  initialCreateCollaboratorModalOpen,
  initialFiltersModalOpen,
  allowedClientValues,
  availableCompanyValues,
}: {
  collaborators: GanttCollaborator[];
  currentUserId?: string;
  currentUserRole?: string;
  selectedTaskId: string;
  zoomKey: string;
  dayCount: number;
  rangeStartIso: string;
  rangeEndIso: string;
  timelineWidth: number;
  initialCreateModalOpen?: boolean;
  initialCreateCollaboratorModalOpen?: boolean;
  initialFiltersModalOpen?: boolean;
  allowedClientValues: string[];
  availableCompanyValues: string[];
}) {
  const router = useRouter();
  const canPlan = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  const canManageUsers = currentUserRole === "ADMIN";
  const canViewNoClientOption = canManageUsers;
  const availableClientValues = allowedClientValues;
  const collaboratorIds = useMemo(() => collaborators.map((collaborator) => collaborator.id), [collaborators]);
  const validClientKeys = useMemo(
    () => (canViewNoClientOption ? [...availableClientValues, NO_CLIENT_KEY] : [...availableClientValues]),
    [availableClientValues, canViewNoClientOption],
  );
  const validCompanyKeys = useMemo(
    () => (canManageUsers ? [...availableCompanyValues, NO_COMPANY_KEY] : []),
    [availableCompanyValues, canManageUsers],
  );
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
  const [newTaskClient, setNewTaskClient] = useState<string>(availableClientValues[0] ?? "SCIO");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState(collaborators[0]?.id ?? "");
  const [newTaskStartDate, setNewTaskStartDate] = useState(() => getDefaultTaskDates().startDate);
  const [newTaskDueDate, setNewTaskDueDate] = useState(() => getDefaultTaskDates().dueDate);
  const [newCollaboratorName, setNewCollaboratorName] = useState("");
  const [newCollaboratorCompany, setNewCollaboratorCompany] = useState("");
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<string[]>(collaboratorIds);
  const [selectedClients, setSelectedClients] = useState<string[]>(validClientKeys);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(validCompanyKeys);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragChangedTaskRef = useRef<string | null>(null);
  const hasAutoScrolledRef = useRef(false);
  const cursorTrackRef = useRef<HTMLElement | null>(null);
  const today = useMemo(() => startOfDay(new Date()), []);
  const rangeStart = useMemo(() => new Date(rangeStartIso), [rangeStartIso]);
  const rangeEnd = useMemo(() => new Date(rangeEndIso), [rangeEndIso]);
  const [effectiveTimelineWidth, setEffectiveTimelineWidth] = useState(timelineWidth);
  const [isCursorDragging, setIsCursorDragging] = useState(false);
  const [cursorDayIndex, setCursorDayIndex] = useState(() =>
    clampDayIndex(diffInDays(new Date(rangeStartIso), startOfDay(new Date())), Math.max(dayCount - 1, 0)),
  );
  const effectiveDayWidth = effectiveTimelineWidth / dayCount;

  useEffect(() => {
    setIsCreateModalOpen(Boolean(initialCreateModalOpen));
  }, [initialCreateModalOpen]);

  useEffect(() => {
    setIsCreateCollaboratorModalOpen(Boolean(initialCreateCollaboratorModalOpen));
  }, [initialCreateCollaboratorModalOpen]);

  useEffect(() => {
    setIsFiltersModalOpen(Boolean(initialFiltersModalOpen));
  }, [initialFiltersModalOpen]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
      setKeyboardShortcutsEnabled(raw === "1");
    } catch {
      setKeyboardShortcutsEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (hasAutoScrolledRef.current) return;

    const scrollContainer = boardRef.current?.closest<HTMLElement>("[data-gantt-scroll-container]");
    if (!scrollContainer) return;

    scrollContainer.scrollLeft = 0;
    hasAutoScrolledRef.current = true;
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const updateTimelineWidth = () => {
      const availableWidth = board.getBoundingClientRect().width - LABEL_WIDTH - 12;
      setEffectiveTimelineWidth(Math.max(360, availableWidth));
    };

    updateTimelineWidth();
    const observer = new ResizeObserver(updateTimelineWidth);
    observer.observe(board);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const todayOffset = diffInDays(rangeStart, today);
    setCursorDayIndex((current) => {
      const safeCurrent = Number.isFinite(current) ? current : todayOffset;
      return clampDayIndex(safeCurrent, Math.max(dayCount - 1, 0));
    });
  }, [dayCount, rangeStart, today]);

  useEffect(() => {
    try {
      const rawCollaborators = window.localStorage.getItem(COLLABORATOR_FILTERS_STORAGE_KEY);
      const parsedCollaborators = rawCollaborators ? JSON.parse(rawCollaborators) : null;
      if (Array.isArray(parsedCollaborators)) {
        const selectedIds = parsedCollaborators.filter((id): id is string => typeof id === "string");
        const next = selectedIds.filter((id) => collaboratorIds.includes(id));
        setSelectedCollaboratorIds(next);
      } else {
        setSelectedCollaboratorIds(collaboratorIds);
      }
    } catch {
      setSelectedCollaboratorIds(collaboratorIds);
    }

    try {
      const rawClients = window.localStorage.getItem(CLIENT_FILTERS_STORAGE_KEY);
      const parsedClients = rawClients ? JSON.parse(rawClients) : null;
      if (Array.isArray(parsedClients)) {
        const selectedKeys = parsedClients.filter((key): key is string => typeof key === "string");
        const hasStaleKeys = selectedKeys.some((key) => !validClientKeys.includes(key));
        const next = hasStaleKeys ? validClientKeys : selectedKeys.filter((key) => validClientKeys.includes(key));
        setSelectedClients(next);
        window.localStorage.setItem(CLIENT_FILTERS_STORAGE_KEY, JSON.stringify(next));
      } else {
        setSelectedClients(validClientKeys);
      }
    } catch {
      setSelectedClients(validClientKeys);
    }

    try {
      const rawCompanies = window.localStorage.getItem(COMPANY_FILTERS_STORAGE_KEY);
      const parsedCompanies = rawCompanies ? JSON.parse(rawCompanies) : null;
      if (Array.isArray(parsedCompanies)) {
        const selectedKeys = parsedCompanies.filter((key): key is string => typeof key === "string");
        const hasStaleKeys = selectedKeys.some((key) => !validCompanyKeys.includes(key));
        const next = hasStaleKeys ? validCompanyKeys : selectedKeys.filter((key) => validCompanyKeys.includes(key));
        setSelectedCompanies(next);
        window.localStorage.setItem(COMPANY_FILTERS_STORAGE_KEY, JSON.stringify(next));
      } else {
        setSelectedCompanies(validCompanyKeys);
      }
    } catch {
      setSelectedCompanies(validCompanyKeys);
    }
  }, [collaborators, collaboratorIds, validClientKeys, validCompanyKeys]);

  useEffect(() => {
    if (!keyboardShortcutsEnabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isCreateModalOpen || isCreateCollaboratorModalOpen || isFiltersModalOpen || Boolean(selectedTaskId)) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        tagName === "button"
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (!["a", "s", "w", "d"].includes(key)) return;

      const params = new URLSearchParams(window.location.search);
      const currentZoomRaw = params.get("zoom") ?? zoomKey;
      const currentZoom = ZOOM_SEQUENCE.includes(currentZoomRaw as (typeof ZOOM_SEQUENCE)[number])
        ? (currentZoomRaw as (typeof ZOOM_SEQUENCE)[number])
        : "1m";
      const currentAnchor = parseDateParam(params.get("anchor")) ?? startOfDay(new Date());

      if (key === "w" || key === "s") {
        const currentIndex = ZOOM_SEQUENCE.indexOf(currentZoom);
        const nextIndex = key === "w" ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= ZOOM_SEQUENCE.length) return;
        params.set("zoom", ZOOM_SEQUENCE[nextIndex]);
        params.set("anchor", toDateParam(currentAnchor));
        event.preventDefault();
        router.push(`/public/gantt?${params.toString()}`, { scroll: false });
        return;
      }

      const direction: -1 | 1 = key === "a" ? -1 : 1;
      const nextAnchor = shiftAnchorByZoom(currentAnchor, currentZoom, direction);
      params.set("zoom", currentZoom);
      params.set("anchor", toDateParam(nextAnchor));
      event.preventDefault();
      router.push(`/public/gantt?${params.toString()}`, { scroll: false });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    keyboardShortcutsEnabled,
    isCreateModalOpen,
    isCreateCollaboratorModalOpen,
    isFiltersModalOpen,
    selectedTaskId,
    router,
    zoomKey,
  ]);

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

  const toggleCompanyFilter = (companyKey: string) => {
    setSelectedCompanies((current) => {
      const next = current.includes(companyKey)
        ? current.filter((key) => key !== companyKey)
        : [...current, companyKey];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(COMPANY_FILTERS_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const activeCollaboratorFilter = selectedCollaboratorIds.filter((id) => collaboratorIds.includes(id));
  const activeClientFilter = selectedClients.filter((key) => validClientKeys.includes(key));
  const activeCompanyFilter = selectedCompanies.filter((key) => validCompanyKeys.includes(key));
  const taskAssignableCollaborators = useMemo(
    () => collaborators.filter((collaborator) => collaborator.visibleClients.includes(newTaskClient)),
    [collaborators, newTaskClient],
  );

  useEffect(() => {
    if (taskAssignableCollaborators.some((collaborator) => collaborator.id === newTaskAssigneeId)) return;
    setNewTaskAssigneeId(taskAssignableCollaborators[0]?.id ?? "");
  }, [newTaskAssigneeId, taskAssignableCollaborators]);

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
        const assigneeCompany = collaborators
          .find((collaborator) => collaborator.id === newTaskAssigneeId)
          ?.company?.trim();
        setSelectedCollaboratorIds((current) => {
          const next = current.includes(newTaskAssigneeId) ? current : [...current, newTaskAssigneeId];
          window.localStorage.setItem(COLLABORATOR_FILTERS_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        setSelectedClients((current) => {
          const next = current.includes(newTaskClient) ? current : [...current, newTaskClient];
          window.localStorage.setItem(CLIENT_FILTERS_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        if (canManageUsers) {
          const companyKey = assigneeCompany || NO_COMPANY_KEY;
          setSelectedCompanies((current) => {
            const next = current.includes(companyKey) ? current : [...current, companyKey];
            window.localStorage.setItem(COMPANY_FILTERS_STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        }
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
    if (!canManageUsers) return;

    const cleanName = newCollaboratorName.trim();
    if (cleanName.length < 2) {
      setDragMessage({ type: "error", text: "El nombre debe tener al menos 2 caracteres." });
      return;
    }

    setDragMessage(null);

    startTransition(async () => {
      try {
        const result = await createCollaboratorFromGanttAction({
          name: cleanName,
          company: newCollaboratorCompany.trim() || undefined,
        });
        if (result?.collaboratorId) {
          setSelectedCollaboratorIds((current) => {
            const next = current.includes(result.collaboratorId) ? current : [...current, result.collaboratorId];
            window.localStorage.setItem(COLLABORATOR_FILTERS_STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        }
        const companyKey = newCollaboratorCompany.trim() || NO_COMPANY_KEY;
        setSelectedCompanies((current) => {
          const next = current.includes(companyKey) ? current : [...current, companyKey];
          window.localStorage.setItem(COMPANY_FILTERS_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        setNewCollaboratorName("");
        setNewCollaboratorCompany("");
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
    .filter((collaborator) => {
      if (!canManageUsers) return true;
      const companyName = collaborator.company?.trim() || "";
      if (!companyName) {
        return activeCompanyFilter.includes(NO_COMPANY_KEY);
      }
      return activeCompanyFilter.includes(companyName);
    })
    .map((collaborator) => ({
      ...collaborator,
      assignedTasks: collaborator.assignedTasks.filter((task) => {
        if (!task.client) {
          return activeClientFilter.includes(NO_CLIENT_KEY);
        }
        return activeClientFilter.includes(task.client);
      }),
    }));
  const collaboratorGroups = Array.from(
    new Set(
      visibleCollaborators
        .map((collaborator) => collaborator.company?.trim() || "")
        .filter((company) => company.length > 0),
    ),
  )
    .map((company) => ({
      company,
      label: company,
      collaborators: visibleCollaborators.filter((collaborator) => (collaborator.company?.trim() || "") === company),
    }))
    .filter((group) => group.collaborators.length > 0);
  const noCompanyCollaborators = visibleCollaborators.filter((collaborator) => !(collaborator.company?.trim()));
  const firstVisibleCollaboratorId = visibleCollaborators[0]?.id ?? null;
  const cursorDate = addDays(rangeStart, cursorDayIndex);
  const cursorDiffFromToday = diffInDays(today, cursorDate);
  const cursorLabel =
    cursorDiffFromToday === 0
      ? "Cursor: hoy"
      : cursorDiffFromToday > 0
        ? `Cursor: +${cursorDiffFromToday} dias`
        : `Cursor: ${cursorDiffFromToday} dias`;

  const updateCursorFromClientX = (clientX: number) => {
    const track = cursorTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pixelOffset = clientX - rect.left - effectiveDayWidth / 2;
    const nextDayIndex = clampDayIndex(Math.round(pixelOffset / effectiveDayWidth), Math.max(dayCount - 1, 0));
    setCursorDayIndex(nextDayIndex);
  };

  const handleCursorPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const trackNode = event.currentTarget.closest<HTMLElement>("[data-gantt-cursor-track]");
    if (!trackNode) return;
    cursorTrackRef.current = trackNode;
    setIsCursorDragging(true);
    updateCursorFromClientX(event.clientX);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCursorPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isCursorDragging) return;
    updateCursorFromClientX(event.clientX);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCursorPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isCursorDragging) return;
    setIsCursorDragging(false);
    updateCursorFromClientX(event.clientX);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleCursorPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isCursorDragging) return;
    setIsCursorDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const toolbarShortcutsSlot =
    typeof document === "undefined" ? null : document.getElementById("gantt-toolbar-shortcuts");
  const toolbarStatusSlot =
    typeof document === "undefined" ? null : document.getElementById("gantt-toolbar-status");
  const shortcutsControl = (
    <button
      type="button"
      role="switch"
      aria-checked={keyboardShortcutsEnabled}
      aria-label="Activar controles ASWD"
      onClick={(event) => {
        const checked = !keyboardShortcutsEnabled;
        setKeyboardShortcutsEnabled(checked);
        try {
          window.localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, checked ? "1" : "0");
        } catch {
          // ignore storage errors and keep runtime toggle
        }
        event.currentTarget.blur();
      }}
      className="inline-flex select-none items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
    >
      <span>ASWD</span>
      <span
        className={cn(
          "relative inline-flex h-4 w-7 rounded-full border transition",
          keyboardShortcutsEnabled
            ? "border-slate-700 bg-slate-900"
            : "border-slate-300 bg-slate-200",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-sm transition",
            keyboardShortcutsEnabled ? "left-[14px]" : "left-[1px]",
          )}
        />
      </span>
    </button>
  );
  const toolbarStatus = dragMessage ? (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-600">
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
  ) : null;

  return (
    <div ref={boardRef} className="space-y-2">
      {toolbarShortcutsSlot ? createPortal(shortcutsControl, toolbarShortcutsSlot) : null}
      {toolbarStatusSlot && toolbarStatus ? createPortal(toolbarStatus, toolbarStatusSlot) : null}
      {visibleCollaborators.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs text-slate-500">
          No hay resultados con los filtros seleccionados.
        </div>
      ) : null}
      {collaboratorGroups.map((group) => (
        <section key={group.company} className="space-y-2">
          {(() => {
            const headerTone = getCompanyHeaderTone(group.label);
            return (
          <div className="flex items-stretch gap-2">
            <div
              className="sticky left-0 z-20 flex h-8 shrink-0 items-center rounded-md px-3"
              style={{ width: `${LABEL_WIDTH}px`, ...headerTone.leftStyle }}
            >
              <h3 className={cn("text-[11px] font-medium uppercase tracking-[0.14em]", headerTone.textClassName)}>{group.label}</h3>
            </div>
            <div className="h-8 min-w-0 flex-1 rounded-md" style={headerTone.rightStyle} />
          </div>
            );
          })()}
          {group.collaborators.map((collaborator) => {
        const barSwatch = getBarSwatch(collaborator.dashboardTone);
        const canOpenModal = currentUserId
          ? currentUserRole === "ADMIN" || currentUserRole === "MANAGER" || currentUserId === collaborator.id
          : false;
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
          <article key={collaborator.id} className="flex items-stretch gap-2">
            <div
              className="sticky left-0 z-20 flex shrink-0 items-center justify-start rounded-[22px] border border-slate-200 bg-white px-3 shadow-[12px_0_24px_-24px_rgba(15,23,42,0.55)]"
              style={{ width: `${LABEL_WIDTH}px`, minHeight: `${rowHeight}px` }}
            >
              <div className="flex items-center gap-2.5">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-gradient-to-br text-xl shadow-sm ${barSwatch}`}>
                  {collaborator.avatarEmoji}
                </span>
                <p className="text-lg font-semibold text-slate-900">{collaborator.name}</p>
              </div>
            </div>

            <div
              data-gantt-collaborator-id={collaborator.id}
              data-gantt-cursor-track={collaborator.id === firstVisibleCollaboratorId ? "1" : undefined}
              className={cn(
                "relative min-w-0 flex-1 overflow-visible rounded-[22px] border border-slate-200 bg-slate-50",
                activeDragId && hoverAssigneeId === collaborator.id ? "ring-2 ring-slate-300/80 ring-offset-2" : "",
              )}
              style={{ height: `${rowHeight}px` }}
            >
              <div
                className="pointer-events-none absolute inset-0 z-0 grid"
                style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: dayCount }).map((_, dayIndex) => {
                  const day = addDays(rangeStart, dayIndex);
                  return (
                    <div
                      key={`${collaborator.id}-bg-${day.toISOString()}`}
                      className={isWeekend(day) ? "bg-slate-100/55" : "bg-white/65"}
                    />
                  );
                })}
              </div>

              {today.getTime() >= rangeStart.getTime() && today.getTime() <= rangeEnd.getTime() ? (
                <div
                  className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-rose-300/90"
                  style={{ left: `${diffInDays(rangeStart, today) * effectiveDayWidth + effectiveDayWidth / 2}px` }}
                >
                  {collaborator.id === firstVisibleCollaboratorId ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-rose-700">
                      Hoy
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div
                className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-sky-400/90"
                style={{ left: `${cursorDayIndex * effectiveDayWidth + effectiveDayWidth / 2}px` }}
              />
              {collaborator.id === firstVisibleCollaboratorId ? (
                <button
                  type="button"
                  aria-label="Mover cursor de fecha"
                  className={cn(
                    "absolute -top-3 z-20 -translate-x-1/2 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-sky-700 transition",
                    isCursorDragging ? "cursor-grabbing shadow-sm" : "cursor-ew-resize hover:bg-sky-100",
                  )}
                  style={{ left: `${cursorDayIndex * effectiveDayWidth + effectiveDayWidth / 2}px` }}
                  onPointerDown={handleCursorPointerDown}
                  onPointerMove={handleCursorPointerMove}
                  onPointerUp={handleCursorPointerUp}
                  onPointerCancel={handleCursorPointerCancel}
                >
                  {cursorLabel}
                </button>
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
                  const left = visibleStartOffset * effectiveDayWidth + 8;
                  const width = Math.max((visibleEndOffset - visibleStartOffset + 1) * effectiveDayWidth - 14, 32);
                  const top = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;
                  const tone = getTaskTone(task, schedule, today);
                  const clientTone = getClientTone(task.client);
                  const isEditableTask = Boolean(canOpenModal);
                  const isDragging = activeDragId === task.id;
                  const sharedClassName = `group absolute rounded-[16px] border bg-gradient-to-r px-2.5 py-1 shadow-[0_12px_30px_-16px_rgba(15,23,42,0.85)] transition hover:z-20 hover:shadow-[0_24px_45px_-20px_rgba(15,23,42,0.45)] ${barSwatch} ${tone.barClassName} ${selectedTaskId === task.id ? "ring-2 ring-slate-950/20" : ""} ${isDragging ? "z-30 shadow-[0_28px_55px_-22px_rgba(15,23,42,0.55)]" : ""}`;
                  const sharedStyle = {
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    minHeight: `${BAR_HEIGHT}px`,
                  };
                  const barContent = (
                    <div className="w-full min-w-0">
                        <div className="flex w-full items-center gap-2">
                          <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${tone.textClassName}`}>{task.title}</p>
                          <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${clientTone}`}>
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

                    const nextDayDelta = Math.round(pixelDelta / effectiveDayWidth);
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
                          className="absolute inset-0 z-10 rounded-[16px] text-left"
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
                <div className="absolute inset-0 flex items-center justify-center px-4">
                  <p className="rounded-full border border-dashed border-slate-300 bg-white/80 px-3 py-1.5 text-xs text-slate-500">
                    Sin tareas con fechas para esta persona.
                  </p>
                </div>
              )}
            </div>
          </article>
        );
          })}
        </section>
      ))}
      {noCompanyCollaborators.length > 0 ? (
        <section className="space-y-2">
          {(() => {
            const headerTone = getCompanyHeaderTone(null);
            return (
          <div className="flex items-stretch gap-2">
            <div
              className="sticky left-0 z-20 flex h-8 shrink-0 items-center rounded-md px-3"
              style={{ width: `${LABEL_WIDTH}px`, ...headerTone.leftStyle }}
            >
              <h3 className={cn("text-[11px] font-medium uppercase tracking-[0.14em]", headerTone.textClassName)}>Sin empresa</h3>
            </div>
            <div className="h-8 min-w-0 flex-1 rounded-md" style={headerTone.rightStyle} />
          </div>
            );
          })()}
          {noCompanyCollaborators.map((collaborator) => {
            const barSwatch = getBarSwatch(collaborator.dashboardTone);
            const canOpenModal = currentUserId
              ? currentUserRole === "ADMIN" || currentUserRole === "MANAGER" || currentUserId === collaborator.id
              : false;
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
              <article key={collaborator.id} className="flex items-stretch gap-2">
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center justify-start rounded-[22px] border border-slate-200 bg-white px-3 shadow-[12px_0_24px_-24px_rgba(15,23,42,0.55)]"
                  style={{ width: `${LABEL_WIDTH}px`, minHeight: `${rowHeight}px` }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-gradient-to-br text-xl shadow-sm ${barSwatch}`}>
                      {collaborator.avatarEmoji}
                    </span>
                    <p className="text-lg font-semibold text-slate-900">{collaborator.name}</p>
                  </div>
                </div>

                <div
                  data-gantt-collaborator-id={collaborator.id}
                  data-gantt-cursor-track={collaborator.id === firstVisibleCollaboratorId ? "1" : undefined}
                  className={cn(
                    "relative min-w-0 flex-1 overflow-visible rounded-[22px] border border-slate-200 bg-slate-50",
                    activeDragId && hoverAssigneeId === collaborator.id ? "ring-2 ring-slate-300/80 ring-offset-2" : "",
                  )}
                  style={{ height: `${rowHeight}px` }}
                >
                  <div
                    className="pointer-events-none absolute inset-0 z-0 grid"
                    style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: dayCount }).map((_, dayIndex) => {
                      const day = addDays(rangeStart, dayIndex);
                      return (
                        <div
                          key={`${collaborator.id}-bg-${day.toISOString()}`}
                          className={isWeekend(day) ? "bg-slate-100/55" : "bg-white/65"}
                        />
                      );
                    })}
                  </div>

                  {today.getTime() >= rangeStart.getTime() && today.getTime() <= rangeEnd.getTime() ? (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-rose-300/90"
                      style={{ left: `${diffInDays(rangeStart, today) * effectiveDayWidth + effectiveDayWidth / 2}px` }}
                    >
                      {collaborator.id === firstVisibleCollaboratorId ? (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-rose-700">
                          Hoy
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-sky-400/90"
                    style={{ left: `${cursorDayIndex * effectiveDayWidth + effectiveDayWidth / 2}px` }}
                  />
                  {collaborator.id === firstVisibleCollaboratorId ? (
                    <button
                      type="button"
                      aria-label="Mover cursor de fecha"
                      className={cn(
                        "absolute -top-3 z-20 -translate-x-1/2 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-sky-700 transition",
                        isCursorDragging ? "cursor-grabbing shadow-sm" : "cursor-ew-resize hover:bg-sky-100",
                      )}
                      style={{ left: `${cursorDayIndex * effectiveDayWidth + effectiveDayWidth / 2}px` }}
                      onPointerDown={handleCursorPointerDown}
                      onPointerMove={handleCursorPointerMove}
                      onPointerUp={handleCursorPointerUp}
                      onPointerCancel={handleCursorPointerCancel}
                    >
                      {cursorLabel}
                    </button>
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
                      const left = visibleStartOffset * effectiveDayWidth + 8;
                      const width = Math.max((visibleEndOffset - visibleStartOffset + 1) * effectiveDayWidth - 14, 32);
                      const top = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;
                      const statusLabel = statusLabelFor(task.status);
                      const tone = getTaskTone(task, schedule, today);
                      const clientTone = getClientTone(task.client);
                      const isEditableTask = Boolean(canOpenModal);
                      const isDragging = activeDragId === task.id;

                      const sharedClassName = `group absolute flex h-[30px] items-center overflow-hidden rounded-[16px] border bg-gradient-to-r px-2.5 py-1 shadow-[0_12px_30px_-16px_rgba(15,23,42,0.85)] transition hover:z-20 hover:shadow-[0_24px_45px_-20px_rgba(15,23,42,0.45)] ${barSwatch} ${tone.barClassName} ${selectedTaskId === task.id ? "ring-2 ring-slate-950/20" : ""} ${isDragging ? "z-30 shadow-[0_28px_55px_-22px_rgba(15,23,42,0.55)]" : ""}`;
                      const sharedStyle = {
                        left: `${left}px`,
                        top: `${top}px`,
                        width: `${width}px`,
                        minHeight: `${BAR_HEIGHT}px`,
                      };

                      const barContent = (
                        <>
                          <span className={cn("mr-2 inline-flex h-2.5 w-2.5 shrink-0 rounded-full", barSwatch)} />
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm font-semibold ${tone.textClassName}`}>{task.title}</p>
                            <p className="truncate text-[11px] text-white/82">
                              {statusLabel}
                              {task.client ? ` · ${taskClientLabel(task.client)}` : ""}
                            </p>
                          </div>
                          <span className={cn("ml-auto inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", clientTone)}>
                            {taskClientLabel(task.client)}
                          </span>
                        </>
                      );

                      const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
                        if (!canPlan) return;
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
                        event.currentTarget.setPointerCapture(event.pointerId);
                      };

                      const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
                        const drag = dragRef.current;
                        if (!drag || drag.taskId !== task.id) return;

                        const pixelDelta = event.clientX - drag.originX;
                        if (!drag.hasMoved && Math.abs(pixelDelta) >= DRAG_ACTIVATION_PX) {
                          drag.hasMoved = true;
                        }

                        const hoveredAssigneeId = resolveCollaboratorIdFromPoint(event.clientX, event.clientY);
                        if (hoveredAssigneeId && hoveredAssigneeId !== drag.targetAssigneeId) {
                          drag.targetAssigneeId = hoveredAssigneeId;
                          setHoverAssigneeId(hoveredAssigneeId);
                          dragChangedTaskRef.current = task.id;
                        }

                        const nextDayDelta = Math.round(pixelDelta / effectiveDayWidth);
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
                              className="absolute inset-0 z-10 rounded-[16px] text-left"
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
                    <div className="absolute inset-0 flex items-center justify-center px-4">
                      <p className="rounded-full border border-dashed border-slate-300 bg-white/80 px-3 py-1.5 text-xs text-slate-500">
                        Sin tareas con fechas para esta persona.
                      </p>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

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
                    onChange={(event) => setNewTaskClient(event.target.value)}
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
                    {taskAssignableCollaborators.map((collaborator) => (
                      <option key={collaborator.id} value={collaborator.id}>
                        {collaborator.name}
                      </option>
                    ))}
                  </select>
                  {taskAssignableCollaborators.length === 0 ? (
                    <p className="mt-1 text-xs text-rose-500">No hay colaboradores con acceso a este cliente.</p>
                  ) : null}
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
      {canManageUsers && isCreateCollaboratorModalOpen ? (
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
                <label className="mb-1 block text-sm text-slate-700">Empresa (opcional)</label>
                <select
                  value={newCollaboratorCompany}
                  onChange={(event) => setNewCollaboratorCompany(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Sin empresa</option>
                  {availableCompanyValues.map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
                </select>
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

            <div className={`mt-4 grid gap-4 ${canManageUsers ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
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
                  <p className="text-sm font-medium text-slate-900">Clientes</p>
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
                      Todos
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
                      Ninguno
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

              {canManageUsers ? (
                <div className="rounded-2xl border border-slate-200 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-900">Empresas</p>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCompanies(validCompanyKeys);
                          if (typeof window !== "undefined") {
                            window.localStorage.setItem(COMPANY_FILTERS_STORAGE_KEY, JSON.stringify(validCompanyKeys));
                          }
                        }}
                        className="text-slate-600 hover:text-slate-900"
                      >
                        Todas
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCompanies([]);
                          if (typeof window !== "undefined") {
                            window.localStorage.setItem(COMPANY_FILTERS_STORAGE_KEY, JSON.stringify([]));
                          }
                        }}
                        className="text-slate-600 hover:text-slate-900"
                      >
                        Ninguna
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {availableCompanyValues.map((company) => (
                      <label key={company} className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={activeCompanyFilter.includes(company)}
                          onChange={() => toggleCompanyFilter(company)}
                        />
                        <span>{company}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={activeCompanyFilter.includes(NO_COMPANY_KEY)}
                        onChange={() => toggleCompanyFilter(NO_COMPANY_KEY)}
                      />
                      <span>Sin empresa</span>
                    </label>
                  </div>
                </div>
              ) : null}
            </div>

          </section>
        </div>
      ) : null}
    </div>
  );
}




