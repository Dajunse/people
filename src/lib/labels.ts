import { Role, TaskClient, TaskStatus } from "@prisma/client";

export function roleLabel(role: Role) {
  return role === Role.ADMIN ? "Admin" : "Colaborador";
}

export function taskStatusLabel(status: TaskStatus) {
  switch (status) {
    case TaskStatus.PENDING:
      return "Pendiente";
    case TaskStatus.IN_PROGRESS:
      return "En progreso";
    case TaskStatus.ALMOST_DONE:
      return "Casi lista";
    case TaskStatus.COMPLETED:
      return "Completada";
    default:
      return status;
  }
}

export function taskClientLabel(client: TaskClient | null | undefined) {
  if (!client) {
    return "Sin cliente";
  }
  return client;
}
