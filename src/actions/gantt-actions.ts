"use server";

import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { Role, TaskDifficulty, TaskHistoryAction, TaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STAFF_ROLES: Role[] = [Role.COLLABORATOR, Role.MANAGER];

const updateTaskFromGanttSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().optional(),
  client: z.string().trim().min(1).max(80),
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
  client: z.string().trim().min(1).max(80),
  assigneeId: z.string().min(1),
  startedAt: z.string().optional(),
  dueDate: z.string().optional(),
});

const createCollaboratorFromGanttSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  company: z.string().trim().max(80).optional().or(z.literal("")),
  primaryClient: z.string().trim().min(1).max(80),
});

function buildInternalEmail(name: string) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  const base = normalized.length > 0 ? normalized : "usuario";
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${base}.${suffix}@people.local`;
}

function generateSecureTemporaryPassword(length = 16) {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}";
  const all = `${lower}${upper}${digits}${symbols}`;

  const chars = [
    lower[randomInt(lower.length)],
    upper[randomInt(upper.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];

  for (let index = chars.length; index < length; index += 1) {
    chars.push(all[randomInt(all.length)]);
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = chars[index];
    chars[index] = chars[swapIndex];
    chars[swapIndex] = current;
  }

  return chars.join("");
}

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

function parseOptionalDate(value?: string) {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function assertManagerCompany(user: { role: Role; company: string | null }) {
  if (user.role !== Role.MANAGER) return;
  if (!user.company?.trim()) {
    throw new Error("El lider no tiene empresa interna configurada.");
  }
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
      client: true,
      startedAt: true,
      almostDoneAt: true,
      completedAt: true,
      assignee: {
        select: {
          company: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error("Tarea no encontrada.");
  }

  assertManagerCompany(user);
  const managerCanEditTeamTask =
    user.role === Role.MANAGER &&
    user.company?.trim() &&
    task.assignee.company === user.company.trim();
  const canEdit = user.role === Role.ADMIN || task.assigneeId === user.id || Boolean(managerCanEditTeamTask);
  if (!canEdit) {
    throw new Error("No tienes permiso para editar esta tarea.");
  }

  if (user.role === Role.COLLABORATOR && parsed.data.assigneeId !== task.assigneeId) {
    throw new Error("Solo admin o lider puede reasignar tareas.");
  }

  let assigneeId = task.assigneeId;
  if (user.role === Role.ADMIN) {
    assigneeId = parsed.data.assigneeId;
  }
  if (user.role === Role.MANAGER) {
    if (parsed.data.assigneeId !== task.assigneeId) {
      const nextAssignee = await prisma.user.findFirst({
        where: {
          id: parsed.data.assigneeId,
          role: { in: STAFF_ROLES },
          isActive: true,
          company: user.company?.trim() || "",
        },
        select: { id: true },
      });
      if (!nextAssignee) {
        throw new Error("Solo puedes reasignar a colegas de tu empresa.");
      }
      assigneeId = nextAssignee.id;
    }
  }

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
      client: parsed.data.client,
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
  assertManagerCompany(user);
  const canShift = user.role === Role.ADMIN || user.role === Role.MANAGER;
  if (!canShift) {
    throw new Error("No tienes permiso para reorganizar la linea del tiempo.");
  }

  const parsed = shiftTaskScheduleSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload invalido para mover la tarea.");
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      assigneeId: true,
      assignee: {
        select: {
          company: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error("Tarea no encontrada.");
  }
  if (user.role === Role.MANAGER && task.assignee.company !== user.company?.trim()) {
    throw new Error("Solo puedes mover tareas de colegas de tu empresa.");
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
        role: { in: STAFF_ROLES },
        isActive: true,
        ...(user.role === Role.MANAGER ? { company: user.company?.trim() || "" } : {}),
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
  client: string;
  assigneeId: string;
  startedAt?: string;
  dueDate?: string;
}) {
  const user = await requireUser();
  assertManagerCompany(user);
  const canCreate = user.role === Role.ADMIN || user.role === Role.MANAGER;
  if (!canCreate) {
    throw new Error("No tienes permiso para crear tareas desde el Gantt.");
  }

  const parsed = createTaskFromGanttSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload invalido para crear la tarea desde Gantt.");
  }
  const assignee = await prisma.user.findFirst({
    where: {
      id: parsed.data.assigneeId,
      role: { in: STAFF_ROLES },
      isActive: true,
      ...(user.role === Role.MANAGER ? { company: user.company?.trim() || "" } : {}),
    },
    select: { id: true },
  });

  if (!assignee) {
    throw new Error("Colaborador asignado invalido.");
  }

  const parsedStartedAt = parseOptionalDate(parsed.data.startedAt);
  const parsedDueDate = parseOptionalDate(parsed.data.dueDate);

  if (parsed.data.startedAt && !parsedStartedAt) {
    throw new Error("Fecha de inicio invalida.");
  }
  if (parsed.data.dueDate && !parsedDueDate) {
    throw new Error("Fecha fin invalida.");
  }

  const startedAt = parsedStartedAt ? startOfDay(parsedStartedAt) : startOfDay(new Date());
  const dueDate = parsedDueDate ? startOfDay(parsedDueDate) : addBusinessDaysInclusive(startedAt, 5);

  if (dueDate.getTime() < startedAt.getTime()) {
    throw new Error("La fecha fin no puede ser menor a la fecha inicio.");
  }

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
      note: "Creada desde Gantt publico.",
    },
  });

  revalidatePath("/public");
  revalidatePath("/public/gantt");
  revalidatePath("/admin/tasks");
  revalidatePath("/dashboard");
}

export async function createCollaboratorFromGanttAction(input: {
  name: string;
  email?: string;
  company?: string;
  primaryClient: string;
}) {
  const user = await requireUser();

  if (user.role !== Role.ADMIN) {
    throw new Error("Solo admin puede crear colaboradores desde el Gantt.");
  }

  const parsed = createCollaboratorFromGanttSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload invalido para crear colaborador desde Gantt.");
  }

  const email = parsed.data.email ? parsed.data.email.toLowerCase() : buildInternalEmail(parsed.data.name);
  const passwordHash = await bcrypt.hash(generateSecureTemporaryPassword(), 12);
  const collaborator = await prisma.user.upsert({
    where: { email },
    update: {
      name: parsed.data.name,
      company: parsed.data.company?.trim() ? parsed.data.company.trim() : null,
      role: Role.COLLABORATOR,
      primaryClient: parsed.data.primaryClient,
      isActive: true,
      passwordHash,
      dashboardTone: "OCEAN",
      avatarPreset: "ROBOT",
      startingRank: "IRON",
    },
    create: {
      name: parsed.data.name,
      email,
      company: parsed.data.company?.trim() ? parsed.data.company.trim() : null,
      role: Role.COLLABORATOR,
      primaryClient: parsed.data.primaryClient,
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
    const activeClients = await prisma.client.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    const clientNames = activeClients.map((client) => client.name);
    await prisma.userClientAccess.createMany({
      data: clientNames.map((client) => ({
        userId: collaborator.id,
        client,
      })),
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public");
  revalidatePath("/public/gantt");
}
