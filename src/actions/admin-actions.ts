"use server";

import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { Role, TaskDifficulty, TaskHistoryAction, TaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AVATAR_PRESET_VALUES } from "@/lib/avatar-presets";
import { DASHBOARD_TONE_VALUES } from "@/lib/dashboard-tones";
import { RANK_TIER_VALUES } from "@/lib/reward-system";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STAFF_ROLES: Role[] = [Role.COLLABORATOR, Role.MANAGER];
const STAFF_ROLE_VALUES = ["COLLABORATOR", "MANAGER"] as const;

const collaboratorSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  company: z.string().trim().max(80).optional().or(z.literal("")),
  role: z.enum(STAFF_ROLE_VALUES).default("COLLABORATOR"),
  primaryClient: z.string().trim().min(1).max(80),
  dashboardTone: z.enum(DASHBOARD_TONE_VALUES),
  avatarPreset: z.enum(AVATAR_PRESET_VALUES),
  startingRank: z.enum(RANK_TIER_VALUES),
  visibleClients: z.array(z.string().trim().min(1).max(80)).optional(),
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

export async function createCollaboratorAction(formData: FormData) {
  await requireAdmin();
  const parsed = collaboratorSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") || undefined,
    company: formData.get("company") || undefined,
    role: formData.get("role") || "COLLABORATOR",
    primaryClient: formData.get("primaryClient"),
    dashboardTone: formData.get("dashboardTone"),
    avatarPreset: formData.get("avatarPreset"),
    startingRank: formData.get("startingRank"),
    visibleClients: formData.getAll("visibleClients"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido de colaborador.");
  }

  const email = parsed.data.email ? parsed.data.email.toLowerCase() : buildInternalEmail(parsed.data.name);
  const passwordHash = await bcrypt.hash(generateSecureTemporaryPassword(), 12);
  const collaborator = await prisma.user.upsert({
    where: { email },
    update: {
      name: parsed.data.name,
      company: parsed.data.company?.trim() ? parsed.data.company.trim() : null,
      role: parsed.data.role as Role,
      primaryClient: parsed.data.primaryClient,
      isActive: true,
      passwordHash,
      dashboardTone: parsed.data.dashboardTone,
      avatarPreset: parsed.data.avatarPreset,
      startingRank: parsed.data.startingRank,
    },
    create: {
      name: parsed.data.name,
      email,
      company: parsed.data.company?.trim() ? parsed.data.company.trim() : null,
      role: parsed.data.role as Role,
      primaryClient: parsed.data.primaryClient,
      isActive: true,
      passwordHash,
      dashboardTone: parsed.data.dashboardTone,
      avatarPreset: parsed.data.avatarPreset,
      startingRank: parsed.data.startingRank,
    },
  });

  const activeClients = await prisma.client.findMany({
    where: { isActive: true },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const selectedClients = parsed.data.visibleClients && parsed.data.visibleClients.length > 0
    ? parsed.data.visibleClients
    : activeClients.map((client) => client.name);
  const allowedClients = Array.from(new Set([parsed.data.primaryClient, ...selectedClients]));

  await prisma.userClientAccess.deleteMany({
    where: { userId: collaborator.id },
  });
  await prisma.userClientAccess.createMany({
    data: allowedClients.map((client) => ({
      userId: collaborator.id,
      client,
    })),
  });

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/public");
}

const taskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  client: z.string().trim().min(1).max(80),
  dueDate: z.string().optional(),
  expectedDoneAt: z.string().optional(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
  difficultyLabel: z.string().optional(),
  starValue: z.coerce.number().int().min(1).max(5),
  assigneeId: z.string().min(1),
});

export async function createTaskAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    client: formData.get("client"),
    dueDate: formData.get("dueDate") || undefined,
    expectedDoneAt: formData.get("expectedDoneAt") || undefined,
    difficulty: formData.get("difficulty") || "MEDIUM",
    difficultyLabel: formData.get("difficultyLabel") || undefined,
    starValue: formData.get("starValue"),
    assigneeId: formData.get("assigneeId"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido de tarea.");
  }

  const dueDate = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T12:00:00.000Z`) : null;
  const expectedDoneAt = parsed.data.expectedDoneAt
    ? new Date(parsed.data.expectedDoneAt)
    : null;

  if (expectedDoneAt && Number.isNaN(expectedDoneAt.getTime())) {
    throw new Error("Fecha estimada invalida.");
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      client: parsed.data.client,
      dueDate,
      expectedDoneAt,
      status: TaskStatus.PENDING,
      difficulty: parsed.data.difficulty as TaskDifficulty,
      difficultyLabel: parsed.data.difficultyLabel,
      starValue: parsed.data.starValue,
      assigneeId: parsed.data.assigneeId,
      createdById: admin.id,
    },
  });

  await prisma.taskHistory.create({
    data: {
      taskId: task.id,
      userId: admin.id,
      action: TaskHistoryAction.CREATED,
      note: "Creada desde panel admin.",
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const collaboratorAppearanceSchema = z.object({
  collaboratorId: z.string().min(1),
  dashboardTone: z.enum(DASHBOARD_TONE_VALUES),
  avatarPreset: z.enum(AVATAR_PRESET_VALUES),
});

export async function updateCollaboratorAppearanceAction(formData: FormData) {
  await requireAdmin();

  const parsed = collaboratorAppearanceSchema.safeParse({
    collaboratorId: formData.get("collaboratorId"),
    dashboardTone: formData.get("dashboardTone"),
    avatarPreset: formData.get("avatarPreset"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para apariencia de colaborador.");
  }

  await prisma.user.updateMany({
    where: {
      id: parsed.data.collaboratorId,
      role: { in: STAFF_ROLES },
      isActive: true,
    },
    data: {
      dashboardTone: parsed.data.dashboardTone,
      avatarPreset: parsed.data.avatarPreset,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/rewards");
  revalidatePath("/public");
}

const collaboratorProfileSchema = z.object({
  collaboratorId: z.string().min(1),
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  company: z.string().trim().max(80).optional().or(z.literal("")),
  password: z.string().optional(),
  role: z.enum(STAFF_ROLE_VALUES).default("COLLABORATOR"),
  primaryClient: z.string().trim().min(1).max(80),
  startingRank: z.enum(RANK_TIER_VALUES),
  visibleClients: z.array(z.string().trim().min(1).max(80)).optional(),
});

export async function updateCollaboratorProfileAction(formData: FormData) {
  await requireAdmin();

  const parsed = collaboratorProfileSchema.safeParse({
    collaboratorId: formData.get("collaboratorId"),
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company") || undefined,
    password: formData.get("password") || undefined,
    role: formData.get("role") || "COLLABORATOR",
    primaryClient: formData.get("primaryClient"),
    startingRank: formData.get("startingRank"),
    visibleClients: formData.getAll("visibleClients"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para editar colaborador.");
  }

  const cleanEmail = parsed.data.email?.trim().toLowerCase() || null;

  const currentCollaborator = await prisma.user.findFirst({
    where: {
      id: parsed.data.collaboratorId,
      role: { in: STAFF_ROLES },
      isActive: true,
    },
    select: { id: true, email: true },
  });

  if (!currentCollaborator) {
    throw new Error("No se encontro el colaborador para editar.");
  }

  const email = cleanEmail ?? currentCollaborator.email;
  const duplicate = await prisma.user.findFirst({
    where: {
      email,
      id: { not: parsed.data.collaboratorId },
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("Ya existe un usuario con ese correo.");
  }

  const updateData: {
    name: string;
    email: string;
    company: string | null;
    role: Role;
    primaryClient: string;
    startingRank: (typeof RANK_TIER_VALUES)[number];
    passwordHash?: string;
  } = {
    name: parsed.data.name,
    email,
    company: parsed.data.company?.trim() ? parsed.data.company.trim() : null,
    role: parsed.data.role as Role,
    primaryClient: parsed.data.primaryClient,
    startingRank: parsed.data.startingRank,
  };

  if (parsed.data.password && parsed.data.password.length > 0) {
    if (parsed.data.password.length < 8) {
      throw new Error("La contrasena debe tener al menos 8 caracteres.");
    }
    updateData.passwordHash = await bcrypt.hash(parsed.data.password, 12);
  }

  await prisma.user.updateMany({
    where: {
      id: parsed.data.collaboratorId,
      role: { in: STAFF_ROLES },
      isActive: true,
    },
    data: updateData,
  });

  const selectedClients = parsed.data.visibleClients ?? [];
  const allowedClients = Array.from(new Set([parsed.data.primaryClient, ...selectedClients]));
  await prisma.userClientAccess.deleteMany({
    where: { userId: parsed.data.collaboratorId },
  });
  if (allowedClients.length > 0) {
    await prisma.userClientAccess.createMany({
      data: allowedClients.map((client) => ({
        userId: parsed.data.collaboratorId,
        client,
      })),
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const deleteTaskSchema = z.object({
  taskId: z.string().min(1),
});

export async function deleteTaskAction(formData: FormData) {
  await requireAdmin();

  const parsed = deleteTaskSchema.safeParse({
    taskId: formData.get("taskId"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para eliminar tarea.");
  }

  await prisma.task.delete({
    where: { id: parsed.data.taskId },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const updateTaskStatusByAdminSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["PENDING", "IN_PROGRESS", "ALMOST_DONE", "COMPLETED"]),
});

export async function updateTaskStatusByAdminAction(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = updateTaskStatusByAdminSchema.safeParse({
    taskId: formData.get("taskId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para actualizar estado.");
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
  });

  if (!task) {
    throw new Error("Tarea no encontrada.");
  }

  const nextStatus = parsed.data.status as TaskStatus;
  if (task.status === nextStatus) {
    revalidatePath("/admin");
    return;
  }

  const now = new Date();
  let historyAction: TaskHistoryAction = TaskHistoryAction.REOPENED;
  const note = `Admin cambio estado de ${task.status} a ${nextStatus}.`;

  const timestamps: {
    startedAt?: Date | null;
    almostDoneAt?: Date | null;
    completedAt?: Date | null;
  } = {};

  if (nextStatus === TaskStatus.PENDING) {
    timestamps.startedAt = null;
    timestamps.almostDoneAt = null;
    timestamps.completedAt = null;
    historyAction = TaskHistoryAction.REOPENED;
  }

  if (nextStatus === TaskStatus.IN_PROGRESS) {
    timestamps.startedAt = task.startedAt ?? now;
    timestamps.almostDoneAt = null;
    timestamps.completedAt = null;
    historyAction = TaskHistoryAction.STARTED;
  }

  if (nextStatus === TaskStatus.ALMOST_DONE) {
    timestamps.startedAt = task.startedAt ?? now;
    timestamps.almostDoneAt = task.almostDoneAt ?? now;
    timestamps.completedAt = null;
    historyAction = TaskHistoryAction.MARKED_ALMOST_DONE;
  }

  if (nextStatus === TaskStatus.COMPLETED) {
    timestamps.startedAt = task.startedAt ?? now;
    timestamps.almostDoneAt = task.almostDoneAt ?? now;
    timestamps.completedAt = now;
    historyAction = TaskHistoryAction.COMPLETED;
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: nextStatus,
      ...timestamps,
    },
  });

  await prisma.taskHistory.create({
    data: {
      taskId: task.id,
      userId: admin.id,
      action: historyAction,
      note,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const updateTaskDatesByAdminSchema = z.object({
  taskId: z.string().min(1),
  assigneeId: z.string().min(1),
  client: z.string().trim().min(1).max(80),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
  difficultyLabel: z.string().optional(),
  starValue: z.coerce.number().int().min(1).max(5),
  startedAt: z.string().optional(),
  dueDate: z.string().optional(),
  expectedDoneAt: z.string().optional(),
});

export async function updateTaskDatesByAdminAction(formData: FormData) {
  await requireAdmin();

  const parsed = updateTaskDatesByAdminSchema.safeParse({
    taskId: formData.get("taskId"),
    assigneeId: formData.get("assigneeId"),
    client: formData.get("client"),
    difficulty: formData.get("difficulty") || "MEDIUM",
    difficultyLabel: formData.get("difficultyLabel") || undefined,
    starValue: formData.get("starValue"),
    startedAt: formData.get("startedAt") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    expectedDoneAt: formData.get("expectedDoneAt") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para actualizar fechas.");
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true },
  });

  if (!task) {
    throw new Error("Tarea no encontrada.");
  }

  const updateData: {
    assigneeId?: string;
    client?: string;
    difficulty?: TaskDifficulty;
    difficultyLabel?: string | null;
    starValue?: number;
    startedAt?: Date | null;
    dueDate?: Date | null;
    expectedDoneAt?: Date | null;
  } = {};

  const assignee = await prisma.user.findFirst({
    where: {
      id: parsed.data.assigneeId,
      role: { in: STAFF_ROLES },
      isActive: true,
    },
    select: { id: true },
  });

  if (!assignee) {
    throw new Error("Colaborador asignado invalido.");
  }

  updateData.assigneeId = assignee.id;
  updateData.client = parsed.data.client;
  updateData.difficulty = parsed.data.difficulty as TaskDifficulty;
  updateData.difficultyLabel = parsed.data.difficultyLabel || null;
  updateData.starValue = parsed.data.starValue;

  if (parsed.data.startedAt) {
    const startedAt = new Date(parsed.data.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      throw new Error("Fecha de comienzo invalida.");
    }
    updateData.startedAt = startedAt;
  } else {
    updateData.startedAt = null;
  }

  if (parsed.data.dueDate) {
    const dueDate = new Date(parsed.data.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      throw new Error("Fecha objetivo invalida.");
    }
    updateData.dueDate = dueDate;
  } else {
    updateData.dueDate = null;
  }

  if (parsed.data.expectedDoneAt) {
    const expectedDoneAt = new Date(parsed.data.expectedDoneAt);
    if (Number.isNaN(expectedDoneAt.getTime())) {
      throw new Error("Fecha estimada invalida.");
    }
    updateData.expectedDoneAt = expectedDoneAt;
  } else {
    updateData.expectedDoneAt = null;
  }

  await prisma.task.update({
    where: { id: task.id },
    data: updateData,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const deleteCollaboratorSchema = z.object({
  collaboratorId: z.string().min(1),
});

export async function deleteCollaboratorAction(formData: FormData) {
  await requireAdmin();

  const parsed = deleteCollaboratorSchema.safeParse({
    collaboratorId: formData.get("collaboratorId"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para eliminar colaborador.");
  }

  await prisma.user.deleteMany({
    where: {
      id: parsed.data.collaboratorId,
      role: { in: STAFF_ROLES },
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const rewardSettingsSchema = z.object({
  starsPerWeekTarget: z.coerce.number().int().min(1).max(100),
  weeksRequiredPerRank: z.coerce.number().int().min(1).max(52),
});

export async function updateRewardSettingsAction(formData: FormData) {
  await requireAdmin();

  const parsed = rewardSettingsSchema.safeParse({
    starsPerWeekTarget: formData.get("starsPerWeekTarget"),
    weeksRequiredPerRank: formData.get("weeksRequiredPerRank"),
  });

  if (!parsed.success) {
    throw new Error("Configuracion de recompensas invalida.");
  }

  await prisma.rewardSettings.upsert({
    where: { id: "default" },
    update: {
      starsPerWeekTarget: parsed.data.starsPerWeekTarget,
      weeksRequiredPerRank: parsed.data.weeksRequiredPerRank,
    },
    create: {
      id: "default",
      starsPerWeekTarget: parsed.data.starsPerWeekTarget,
      weeksRequiredPerRank: parsed.data.weeksRequiredPerRank,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const rewardSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  minRank: z.enum(RANK_TIER_VALUES),
  isActive: z.enum(["0", "1"]).default("1"),
});

export async function createRewardAction(formData: FormData) {
  await requireAdmin();

  const parsed = rewardSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    minRank: formData.get("minRank"),
    isActive: formData.get("isActive") ?? "1",
  });

  if (!parsed.success) {
    throw new Error("Recompensa invalida.");
  }

  await prisma.reward.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      minRank: parsed.data.minRank,
      isActive: parsed.data.isActive === "1",
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const deleteRewardSchema = z.object({
  rewardId: z.string().min(1),
});

export async function deleteRewardAction(formData: FormData) {
  await requireAdmin();

  const parsed = deleteRewardSchema.safeParse({
    rewardId: formData.get("rewardId"),
  });

  if (!parsed.success) {
    throw new Error("Recompensa invalida para eliminar.");
  }

  await prisma.reward.delete({
    where: { id: parsed.data.rewardId },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/rewards");
  revalidatePath("/dashboard");
  revalidatePath("/public");
}

const companySchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function createCompanyAction(formData: FormData) {
  await requireAdmin();
  const parsed = companySchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    throw new Error("Nombre de empresa invalido.");
  }

  await prisma.company.upsert({
    where: { name: parsed.data.name },
    update: { isActive: true },
    create: { name: parsed.data.name, isActive: true },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/public/gantt");
}

const deleteCompanySchema = z.object({
  companyId: z.string().min(1),
});

export async function deleteCompanyAction(formData: FormData) {
  await requireAdmin();
  const parsed = deleteCompanySchema.safeParse({
    companyId: formData.get("companyId"),
  });
  if (!parsed.success) {
    throw new Error("Empresa invalida.");
  }

  await prisma.company.update({
    where: { id: parsed.data.companyId },
    data: { isActive: false },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/public/gantt");
}

export async function activateCompanyAction(formData: FormData) {
  await requireAdmin();
  const parsed = deleteCompanySchema.safeParse({
    companyId: formData.get("companyId"),
  });
  if (!parsed.success) {
    throw new Error("Empresa invalida.");
  }

  await prisma.company.update({
    where: { id: parsed.data.companyId },
    data: { isActive: true },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/public/gantt");
}

const updateCompanySchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
});

export async function updateCompanyAction(formData: FormData) {
  await requireAdmin();
  const parsed = updateCompanySchema.safeParse({
    companyId: formData.get("companyId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    throw new Error("Datos invalidos para editar empresa.");
  }

  await prisma.$transaction(async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: parsed.data.companyId },
      select: { name: true },
    });
    if (!company) {
      throw new Error("Empresa no encontrada.");
    }

    await tx.company.update({
      where: { id: parsed.data.companyId },
      data: { name: parsed.data.name },
    });

    if (company.name !== parsed.data.name) {
      await tx.user.updateMany({
        where: { company: company.name },
        data: { company: parsed.data.name },
      });
    }
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/public/gantt");
}

export async function deleteCompanyPermanentAction(formData: FormData) {
  await requireAdmin();
  const parsed = deleteCompanySchema.safeParse({
    companyId: formData.get("companyId"),
  });
  if (!parsed.success) {
    throw new Error("Empresa invalida.");
  }

  await prisma.company.delete({
    where: { id: parsed.data.companyId },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/public/gantt");
}

const clientSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function createClientAction(formData: FormData) {
  await requireAdmin();
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    throw new Error("Nombre de cliente invalido.");
  }

  await prisma.client.upsert({
    where: { name: parsed.data.name },
    update: { isActive: true },
    create: { name: parsed.data.name, isActive: true },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public/gantt");
}

const deleteClientSchema = z.object({
  clientId: z.string().min(1),
});

export async function deleteClientAction(formData: FormData) {
  await requireAdmin();
  const parsed = deleteClientSchema.safeParse({
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) {
    throw new Error("Cliente invalido.");
  }

  await prisma.client.update({
    where: { id: parsed.data.clientId },
    data: { isActive: false },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public/gantt");
}

export async function activateClientAction(formData: FormData) {
  await requireAdmin();
  const parsed = deleteClientSchema.safeParse({
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) {
    throw new Error("Cliente invalido.");
  }

  await prisma.client.update({
    where: { id: parsed.data.clientId },
    data: { isActive: true },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public/gantt");
}

const updateClientSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
});

export async function updateClientAction(formData: FormData) {
  await requireAdmin();
  const parsed = updateClientSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    throw new Error("Datos invalidos para editar cliente.");
  }

  await prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({
      where: { id: parsed.data.clientId },
      select: { name: true },
    });
    if (!client) {
      throw new Error("Cliente no encontrado.");
    }

    await tx.client.update({
      where: { id: parsed.data.clientId },
      data: { name: parsed.data.name },
    });

    if (client.name !== parsed.data.name) {
      await tx.task.updateMany({
        where: { client: client.name },
        data: { client: parsed.data.name },
      });
      await tx.user.updateMany({
        where: { primaryClient: client.name },
        data: { primaryClient: parsed.data.name },
      });
      await tx.userClientAccess.updateMany({
        where: { client: client.name },
        data: { client: parsed.data.name },
      });
    }
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public/gantt");
}

export async function deleteClientPermanentAction(formData: FormData) {
  await requireAdmin();
  const parsed = deleteClientSchema.safeParse({
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) {
    throw new Error("Cliente invalido.");
  }

  await prisma.client.delete({
    where: { id: parsed.data.clientId },
  });

  revalidatePath("/admin/catalogs");
  revalidatePath("/admin/users");
  revalidatePath("/admin/tasks");
  revalidatePath("/public/gantt");
}
