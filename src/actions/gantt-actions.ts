"use server";

import { Role, TaskClient, TaskStatus } from "@prisma/client";
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
