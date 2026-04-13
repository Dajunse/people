"use client";

import { deleteCollaboratorAction } from "@/actions/admin-actions";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  collaboratorId: string;
};

export function DeleteCollaboratorButton({ collaboratorId }: Props) {
  return (
    <form action={deleteCollaboratorAction}>
      <input type="hidden" name="collaboratorId" value={collaboratorId} />
      <SubmitButton
        idleLabel="Eliminar usuario"
        pendingLabel="Eliminando..."
        onClick={(event) => {
          const ok = window.confirm("Eliminar este usuario colaborador? Tambien se eliminaran sus tareas.");
          if (!ok) {
            event.preventDefault();
          }
        }}
        className="rounded-xl border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
      />
    </form>
  );
}
