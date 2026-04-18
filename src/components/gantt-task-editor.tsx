import Link from "next/link";
import { Role, TaskStatus, type User } from "@prisma/client";
import { updateTaskFromGanttAction } from "@/actions/gantt-actions";
import { DeleteTaskButton } from "@/components/delete-task-button";
import { taskClientLabel, taskStatusLabel } from "@/lib/labels";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";
import { SubmitButton } from "@/components/submit-button";

function toDateTimeLocal(date: Date | null) {
  if (!date) return "";
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

export function GanttTaskEditor({
  currentUser,
  task,
  collaborators,
  zoomKey,
}: {
  currentUser: User;
  task: {
    id: string;
    title: string;
    description: string | null;
    client: string | null;
    status: TaskStatus;
    assigneeId: string;
    startedAt: Date | null;
    dueDate: Date | null;
    expectedDoneAt: Date | null;
    assignee: {
      id: string;
      name: string;
    };
  };
  collaborators: Array<{ id: string; name: string }>;
  zoomKey: string;
}) {
  const isAdmin = currentUser.role === Role.ADMIN;

  return (
    <section className="rounded-[32px] border border-white/70 bg-white p-6 shadow-[0_32px_100px_-36px_rgba(15,23,42,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Edicion desde Gantt</p>
          <h2 className="text-2xl font-semibold text-slate-950">{task.title}</h2>
          <p className="text-sm text-slate-500">
            Ajusta cliente, responsable y fechas sin salir de la linea de tiempo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? <DeleteTaskButton taskId={task.id} /> : null}
          <Link
            href={`/public/gantt?zoom=${zoomKey}`}
            className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
          >
            Cerrar editor
          </Link>
        </div>
      </div>

      <form action={updateTaskFromGanttAction} className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input type="hidden" name="taskId" value={task.id} />

        <div className="xl:col-span-2">
          <label className="mb-1 block text-sm text-slate-700">Titulo</label>
          <input
            name="title"
            defaultValue={task.title}
            required
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Cliente</label>
          <select
            name="client"
            defaultValue={task.client ?? "SCIO"}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          >
            {TASK_CLIENT_VALUES.map((client) => (
              <option key={client} value={client}>
                {taskClientLabel(client)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Estado</label>
          <select
            name="status"
            defaultValue={task.status}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          >
            {[TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.ALMOST_DONE, TaskStatus.COMPLETED].map((status) => (
              <option key={status} value={status}>
                {taskStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 xl:col-span-4">
          <label className="mb-1 block text-sm text-slate-700">Descripcion</label>
          <textarea
            name="description"
            rows={3}
            defaultValue={task.description ?? ""}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Inicio</label>
          <input
            type="datetime-local"
            name="startedAt"
            defaultValue={toDateTimeLocal(task.startedAt)}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Fecha objetivo</label>
          <input
            type="datetime-local"
            name="dueDate"
            defaultValue={toDateTimeLocal(task.dueDate)}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Cierre estimado</label>
          <input
            type="datetime-local"
            name="expectedDoneAt"
            defaultValue={toDateTimeLocal(task.expectedDoneAt)}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Responsable</label>
          {isAdmin ? (
            <select
              name="assigneeId"
              defaultValue={task.assigneeId}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2"
            >
              {collaborators.map((collaborator) => (
                <option key={collaborator.id} value={collaborator.id}>
                  {collaborator.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="assigneeId" value={task.assigneeId} />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {task.assignee.name}
              </div>
            </>
          )}
        </div>

        <div className="xl:col-span-4 flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="text-sm text-slate-500">
            Solo el responsable de la tarea o un admin puede editarla desde esta vista.
          </p>
          <SubmitButton
            idleLabel="Guardar cambios"
            pendingLabel="Guardando..."
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>
      </form>

    </section>
  );
}
