"use server";

import { Role, TaskHistoryAction, TaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  actionType: z.enum(["START", "ALMOST_DONE", "COMPLETE", "REOPEN"]),
});

const VALID_STATUS_TRANSITIONS: Record<
  z.infer<typeof updateTaskSchema>["actionType"],
  TaskStatus[]
> = {
  START: [TaskStatus.PENDING],
  ALMOST_DONE: [TaskStatus.IN_PROGRESS],
  COMPLETE: [TaskStatus.ALMOST_DONE],
  REOPEN: [TaskStatus.COMPLETED],
};

export async function updateTaskProgressAction(formData: FormData) {
  const user = await requireUser();
  const parsed = updateTaskSchema.safeParse({
    taskId: formData.get("taskId"),
    actionType: formData.get("actionType"),
  });

  if (!parsed.success) {
    throw new Error("Accion de tarea invalida.");
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
  });
  if (!task) {
    throw new Error("Tarea no encontrada.");
  }

  const canManage = user.role === Role.ADMIN || task.assigneeId === user.id;
  if (!canManage) {
    throw new Error("No tienes permiso para actualizar esta tarea.");
  }

  const allowedStatuses = VALID_STATUS_TRANSITIONS[parsed.data.actionType];
  if (!allowedStatuses.includes(task.status)) {
    throw new Error("La transicion solicitada no es valida para el estado actual.");
  }

  const now = new Date();
  let nextStatus = task.status;
  let historyAction: TaskHistoryAction = TaskHistoryAction.STARTED;
  let note = "";

  if (parsed.data.actionType === "START") {
    nextStatus = TaskStatus.IN_PROGRESS;
    historyAction = TaskHistoryAction.STARTED;
    note = "La tarea fue iniciada.";
  }

  if (parsed.data.actionType === "ALMOST_DONE") {
    nextStatus = TaskStatus.ALMOST_DONE;
    historyAction = TaskHistoryAction.MARKED_ALMOST_DONE;
    note = "La tarea fue marcada como casi lista.";
  }

  if (parsed.data.actionType === "COMPLETE") {
    nextStatus = TaskStatus.COMPLETED;
    historyAction = TaskHistoryAction.COMPLETED;
    note = "La tarea fue finalizada.";
  }

  if (parsed.data.actionType === "REOPEN") {
    if (user.role !== Role.ADMIN) {
      throw new Error("Solo admin puede reabrir tareas.");
    }
    nextStatus = TaskStatus.IN_PROGRESS;
    historyAction = TaskHistoryAction.REOPENED;
    note = "La tarea fue reabierta.";
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: nextStatus,
      startedAt: parsed.data.actionType === "START" && !task.startedAt ? now : task.startedAt,
      almostDoneAt: parsed.data.actionType === "ALMOST_DONE" ? now : task.almostDoneAt,
      completedAt: parsed.data.actionType === "COMPLETE" ? now : parsed.data.actionType === "REOPEN" ? null : task.completedAt,
    },
  });

  await prisma.taskHistory.create({
    data: {
      taskId: task.id,
      userId: user.id,
      action: historyAction,
      note,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/admin");
}
