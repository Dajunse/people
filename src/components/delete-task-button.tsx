"use client";

import { deleteTaskAction } from "@/actions/admin-actions";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  taskId: string;
};

export function DeleteTaskButton({ taskId }: Props) {
  return (
    <form action={deleteTaskAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton
        idleLabel="Eliminar"
        pendingLabel="Eliminando..."
        onClick={(event) => {
          const ok = window.confirm("Eliminar esta tarea? Esta accion no se puede deshacer.");
          if (!ok) {
            event.preventDefault();
          }
        }}
        className="rounded-xl border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
      />
    </form>
  );
}
