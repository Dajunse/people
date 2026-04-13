"use client";

import { useFormStatus } from "react-dom";
import { updateTaskStatusByAdminAction } from "@/actions/admin-actions";

type Props = {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "ALMOST_DONE" | "COMPLETED";
};

function TaskStatusSelect({ status }: { status: Props["status"] }) {
  const { pending } = useFormStatus();

  return (
    <select
      name="status"
      defaultValue={status}
      disabled={pending}
      onChange={(event) => {
        event.currentTarget.form?.requestSubmit();
      }}
      className="rounded-xl border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <option value="PENDING">Pendiente</option>
      <option value="IN_PROGRESS">En progreso</option>
      <option value="ALMOST_DONE">Casi lista</option>
      <option value="COMPLETED">Completada</option>
    </select>
  );
}

export function TaskStatusSelectForm({ taskId, status }: Props) {
  return (
    <form action={updateTaskStatusByAdminAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <TaskStatusSelect status={status} />
    </form>
  );
}
