"use server";

import bcrypt from "bcryptjs";
import { Role, TaskClient, TaskDifficulty, TaskHistoryAction, TaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AVATAR_PRESET_VALUES } from "@/lib/avatar-presets";
import { DASHBOARD_TONE_VALUES } from "@/lib/dashboard-tones";
import { RANK_TIER_VALUES } from "@/lib/reward-system";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const collaboratorSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  dashboardTone: z.enum(DASHBOARD_TONE_VALUES),
  avatarPreset: z.enum(AVATAR_PRESET_VALUES),
  startingRank: z.enum(RANK_TIER_VALUES),
});

export async function createCollaboratorAction(formData: FormData) {
  await requireAdmin();
  const parsed = collaboratorSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    dashboardTone: formData.get("dashboardTone"),
    avatarPreset: formData.get("avatarPreset"),
    startingRank: formData.get("startingRank"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido de colaborador.");
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.upsert({
    where: { email: parsed.data.email.toLowerCase() },
    update: {
      name: parsed.data.name,
      role: Role.COLLABORATOR,
      isActive: true,
      passwordHash,
      dashboardTone: parsed.data.dashboardTone,
      avatarPreset: parsed.data.avatarPreset,
      startingRank: parsed.data.startingRank,
    },
    create: {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: Role.COLLABORATOR,
      isActive: true,
      passwordHash,
      dashboardTone: parsed.data.dashboardTone,
      avatarPreset: parsed.data.avatarPreset,
      startingRank: parsed.data.startingRank,
    },
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
  client: z.enum(TASK_CLIENT_VALUES),
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
      client: parsed.data.client as TaskClient,
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
      role: Role.COLLABORATOR,
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
  email: z.string().email(),
  password: z.string().optional(),
  startingRank: z.enum(RANK_TIER_VALUES),
});

export async function updateCollaboratorProfileAction(formData: FormData) {
  await requireAdmin();

  const parsed = collaboratorProfileSchema.safeParse({
    collaboratorId: formData.get("collaboratorId"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password") || undefined,
    startingRank: formData.get("startingRank"),
  });

  if (!parsed.success) {
    throw new Error("Payload invalido para editar colaborador.");
  }

  const email = parsed.data.email.toLowerCase();
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
    startingRank: (typeof RANK_TIER_VALUES)[number];
    passwordHash?: string;
  } = {
    name: parsed.data.name,
    email,
    startingRank: parsed.data.startingRank,
  };

  if (parsed.data.password && parsed.data.password.length > 0) {
    if (parsed.data.password.length < 8) {
      throw new Error("La contrasena debe tener al menos 8 caracteres.");
    }
    updateData.passwordHash = await bcrypt.hash(parsed.data.password, 12);
  }

  const result = await prisma.user.updateMany({
    where: {
      id: parsed.data.collaboratorId,
      role: Role.COLLABORATOR,
      isActive: true,
    },
    data: updateData,
  });

  if (result.count === 0) {
    throw new Error("No se encontro el colaborador para editar.");
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
  client: z.enum(TASK_CLIENT_VALUES),
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
    client?: TaskClient;
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
      role: Role.COLLABORATOR,
      isActive: true,
    },
    select: { id: true },
  });

  if (!assignee) {
    throw new Error("Colaborador asignado invalido.");
  }

  updateData.assigneeId = assignee.id;
  updateData.client = parsed.data.client as TaskClient;
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
      role: Role.COLLABORATOR,
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
