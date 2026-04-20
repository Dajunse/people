"use server";

import bcrypt from "bcryptjs";
import { Role, TaskClient, TaskDifficulty, TaskHistoryAction, TaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";

const updateTaskFromGanttSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().optional(),
  client: z.enum(TASK_CLIENT_VALUES),
  status: z.enum(["PENDING", "IN_PROGRESS", "ALMOST_DONE", "COMPLETED"]),
  assigneeId: z.string().min(1),
  startedAt: z.string().optional(),
  dueDate: z.string().optional(),
  expectedDoneAt: z.string().optional(),
});

const shiftTaskScheduleSchema = z.object({
  taskId: z.string().min(1),
  startedAt: z.string().min(1),
  dueDate: z.string().min(1),
  assigneeId: z.string().min(1).optional(),
});

const createTaskFromGanttSchema = z.object({
  title: z.string().min(2),
  client: z.enum(TASK_CLIENT_VALUES),
  assigneeId: z.string().min(1),
});

const createCollaboratorFromGanttSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function nextBusinessDay(date: Date) {
  const next = startOfDay(date);
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

export async function updateTaskFromGanttAction(formData: FormData) {
  const user = await requireUser();

  const parsed = updateTaskFromGanttSchema.safeParse({
    taskId: formData.get("taskId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    client: formData.get("client"),
    status: formData.get("status"),
    assigneeId: formData.get("assigneeId"),
    startedAt: formData.get("startedAt") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    expectedDoneAt: formData.get("expectedDoneAt") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para editar tarea desde el Gantt.");
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      assigneeId: true,
      startedAt: true,
      almostDoneAt: true,
      completedAt: true,
    },
  });

  if (!task) {
    throw new Error("Tarea no encontrada.");
  }

  const canEdit = user.role === Role.ADMIN || task.assigneeId === user.id;
  if (!canEdit) {
    throw new Error("No tienes permiso para editar esta tarea.");
  }

  if (user.role !== Role.ADMIN && parsed.data.assigneeId !== task.assigneeId) {
    throw new Error("Solo admin puede reasignar tareas.");
  }

  const assigneeId = user.role === Role.ADMIN ? parsed.data.assigneeId : task.assigneeId;

  const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : null;
  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  const expectedDoneAt = parsed.data.expectedDoneAt ? new Date(parsed.data.expectedDoneAt) : null;

  if (startedAt && Number.isNaN(startedAt.getTime())) {
    throw new Error("Fecha de inicio invalida.");
  }
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    throw new Error("Fecha objetivo invalida.");
  }
  if (expectedDoneAt && Number.isNaN(expectedDoneAt.getTime())) {
    throw new Error("Fecha estimada invalida.");
  }

  const nextStatus = parsed.data.status as TaskStatus;
  const now = new Date();

  await prisma.task.update({
    where: { id: task.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      client: parsed.data.client as TaskClient,
      status: nextStatus,
      assigneeId,
      startedAt,
      dueDate,
      expectedDoneAt,
      almostDoneAt:
        nextStatus === TaskStatus.ALMOST_DONE
          ? task.almostDoneAt ?? now
          : nextStatus === TaskStatus.COMPLETED || nextStatus === TaskStatus.IN_PROGRESS || nextStatus === TaskStatus.PENDING
            ? null
            : task.almostDoneAt,
      completedAt:
        nextStatus === TaskStatus.COMPLETED
          ? task.completedAt ?? now
          : null,
    },
  });

  revalidatePath("/public");
  revalidatePath("/public/gantt");
  revalidatePath("/admin/tasks");
  revalidatePath("/dashboard");
}

export async function shiftTaskScheduleAction(input: {
  taskId: string;
  startedAt: string;
  dueDate: string;
  assigneeId?: string;
}) {
  const user = await requireUser();

  if (user.role !== Role.ADMIN) {
    throw new Error("Solo admin puede reorganizar la linea del tiempo.");
  }

  const parsed = shiftTaskScheduleSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload invalido para mover la tarea.");
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true, assigneeId: true },
  });

  if (!task) {
    throw new Error("Tarea no encontrada.");
  }

  const startedAt = new Date(parsed.data.startedAt);
  const dueDate = new Date(parsed.data.dueDate);

  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(dueDate.getTime())) {
    throw new Error("Fechas invalidas al mover la tarea.");
  }

  let nextAssigneeId = task.assigneeId;
  if (parsed.data.assigneeId && parsed.data.assigneeId !== task.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: parsed.data.assigneeId,
        role: Role.COLLABORATOR,
        isActive: true,
      },
      select: { id: true },
    });

    if (!assignee) {
      throw new Error("Colaborador asignado invalido.");
    }
    nextAssigneeId = assignee.id;
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      startedAt,
      dueDate: dueDate.getTime() < startedAt.getTime() ? startedAt : dueDate,
      assigneeId: nextAssigneeId,
    },
  });

  revalidatePath("/public");
  revalidatePath("/public/gantt");
  revalidatePath("/admin/tasks");
  revalidatePath("/dashboard");
}

export async function createTaskFromGanttAction(input: {
  title: string;
  client: TaskClient;
  assigneeId: string;
}) {
  const user = await requireUser();

  if (user.role !== Role.ADMIN) {
    throw new Error("Solo admin puede crear tareas desde el Gantt.");
  }

  const parsed = createTaskFromGanttSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload invalido para crear la tarea desde Gantt.");
  }

  const assignee = await prisma.user.findFirst({
    where: {
      id: parsed.data.assigneeId,
      role: Role.COLLABORATOR,
      isActive: true,
    },
    select: { id: true },
  });

  if (!assignee) {
    throw new Error("Colaborador asignado invalido.");
  }

  const startedAt = nextBusinessDay(new Date());
  const dueDate = addBusinessDaysInclusive(startedAt, 5);

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      client: parsed.data.client,
      status: TaskStatus.PENDING,
      difficulty: TaskDifficulty.MEDIUM,
      starValue: 2,
      assigneeId: assignee.id,
      createdById: user.id,
      startedAt,
      dueDate,
    },
  });

  await prisma.taskHistory.create({
    data: {
      taskId: task.id,
      userId: user.id,
      action: TaskHistoryAction.CREATED,
      note: "Creada desde Gantt publico por arrastre.",
    },
  });

  revalidatePath("/public");
  revalidatePath("/public/gantt");
  revalidatePath("/admin/tasks");
  revalidatePath("/dashboard");
}

export async function createCollaboratorFromGanttAction(input: {
  name: string;
  email: string;
  password: string;
}) {
  const user = await requireUser();

  if (user.role !== Role.ADMIN) {
    throw new Error("Solo admin puede crear colaboradores desde el Gantt.");
  }

  const parsed = createCollaboratorFromGanttSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload invalido para crear colaborador desde Gantt.");
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const collaborator = await prisma.user.upsert({
    where: { email: parsed.data.email.toLowerCase() },
    update: {
      name: parsed.data.name,
      role: Role.COLLABORATOR,
      isActive: true,
      passwordHash,
      dashboardTone: "OCEAN",
      avatarPreset: "ROBOT",
      startingRank: "IRON",
    },
    create: {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: Role.COLLABORATOR,
      isActive: true,
      passwordHash,
      dashboardTone: "OCEAN",
      avatarPreset: "ROBOT",
      startingRank: "IRON",
    },
  });

  const existingClientAccess = await prisma.userClientAccess.count({
    where: { userId: collaborator.id },
  });
  if (existingClientAccess === 0) {
    await prisma.userClientAccess.createMany({
      data: TASK_CLIENT_VALUES.map((client) => ({
        userId: collaborator.id,
        client,
      })),
      skipDuplicates: true,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public");
  revalidatePath("/public/gantt");
}
