import { Role, TaskStatus } from "@prisma/client";
import { createTaskAction, updateTaskDatesByAdminAction } from "@/actions/admin-actions";
import { AdminSectionsNav } from "@/components/admin-sections-nav";
import { DeleteTaskButton } from "@/components/delete-task-button";
import { PageTitle } from "@/components/page-title";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { TaskStatusSelectForm } from "@/components/task-status-select-form";
import { requireAdmin } from "@/lib/auth";
import { taskClientLabel, taskStatusLabel } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";
import { formatDate } from "@/lib/utils";

function toDateTimeLocal(date: Date | null) {
  if (!date) return "";
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_FILTER_OPTIONS = [
  "ALL",
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
  TaskStatus.ALMOST_DONE,
  TaskStatus.COMPLETED,
] as const;

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string | string[];
    status?: string | string[];
    assigneeId?: string | string[];
  }>;
}) {
  await requireAdmin();

  const resolvedSearchParams = await searchParams;
  const query = firstValue(resolvedSearchParams.query)?.trim() ?? "";
  const rawStatusFilter = firstValue(resolvedSearchParams.status) ?? "ALL";
  const statusFilter = STATUS_FILTER_OPTIONS.includes(
    rawStatusFilter as (typeof STATUS_FILTER_OPTIONS)[number],
  )
    ? rawStatusFilter
    : "ALL";
  const assigneeFilter = firstValue(resolvedSearchParams.assigneeId) ?? "ALL";

  const [collaborators, taskCounts, tasks, activeClients] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.COLLABORATOR, Role.MANAGER] }, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.task.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { title: { contains: query } },
                { description: { contains: query } },
              ],
            }
          : {}),
        ...(statusFilter !== "ALL"
          ? {
              status: statusFilter as TaskStatus,
            }
          : {}),
        ...(assigneeFilter !== "ALL"
          ? {
              assigneeId: assigneeFilter,
            }
          : {}),
      },
      include: { assignee: true },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 60,
    }),
    prisma.client.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);
  const clientOptions = activeClients.length > 0 ? activeClients.map((client) => client.name) : [...TASK_CLIENT_VALUES];

  const countsByStatus = new Map(
    taskCounts.map((item) => [item.status, item._count._all]),
  );

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle
          title="Administracion de Tareas"
          subtitle="Crea, filtra y ajusta tareas sin perder contexto del equipo."
        />
        <AdminSectionsNav />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Pendientes</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{countsByStatus.get(TaskStatus.PENDING) ?? 0}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">En progreso</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{countsByStatus.get(TaskStatus.IN_PROGRESS) ?? 0}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Casi listas</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{countsByStatus.get(TaskStatus.ALMOST_DONE) ?? 0}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Mostrando</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{tasks.length}</p>
        </article>
      </div>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Nueva tarea</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Define responsable, estrellas y prioridad desde una sola vista.
            </p>
          </div>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
            Flujo operativo
          </span>
        </div>
        <form action={createTaskAction} className="mt-3 grid gap-3">
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Titulo</label>
            <input name="title" required className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Descripcion</label>
            <textarea name="description" rows={3} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Asignar a</label>
              <select name="assigneeId" required disabled={collaborators.length === 0} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 disabled:bg-zinc-100">
                {collaborators.map((collaborator) => (
                  <option key={collaborator.id} value={collaborator.id}>
                    {collaborator.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Cliente</label>
              <select name="client" defaultValue={clientOptions[0] ?? "SCIO"} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
                {clientOptions.map((client) => (
                  <option key={client} value={client}>
                    {taskClientLabel(client)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Fecha objetivo (opcional)</label>
              <input name="dueDate" type="date" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Fecha estimada de cierre</label>
              <input
                name="expectedDoneAt"
                type="datetime-local"
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Estrellas (1-5)</label>
              <input
                name="starValue"
                type="number"
                min={1}
                max={5}
                defaultValue={2}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Dificultad</label>
              <select name="difficulty" defaultValue="MEDIUM" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
                <option value="EASY">Facil</option>
                <option value="MEDIUM">Media</option>
                <option value="HARD">Dificil</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Nombre de dificultad (tematica)</label>
              <input
                name="difficultyLabel"
                placeholder="Ej. Jefe Maestro, Retador, Leyenda..."
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
              />
            </div>
          </div>
          {collaborators.length === 0 ? (
            <p className="text-sm text-amber-700">No hay colaboradores activos para asignar tareas.</p>
          ) : null}
          <SubmitButton
            idleLabel="Crear tarea"
            pendingLabel="Creando tarea..."
            disabled={collaborators.length === 0}
            className="w-fit rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          />
        </form>
      </article>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Filtro rapido</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Busca por titulo o descripcion y combina filtros por estado y responsable.
            </p>
          </div>
          <p className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
            Hasta 60 resultados
          </p>
        </div>

        <form className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_220px_220px_auto_auto] md:items-end">
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Buscar</label>
            <input
              name="query"
              defaultValue={query}
              placeholder="Titulo o descripcion"
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Estado</label>
            <select name="status" defaultValue={statusFilter} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="ALL">Todos</option>
              <option value="PENDING">{taskStatusLabel(TaskStatus.PENDING)}</option>
              <option value="IN_PROGRESS">{taskStatusLabel(TaskStatus.IN_PROGRESS)}</option>
              <option value="ALMOST_DONE">{taskStatusLabel(TaskStatus.ALMOST_DONE)}</option>
              <option value="COMPLETED">{taskStatusLabel(TaskStatus.COMPLETED)}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Responsable</label>
            <select name="assigneeId" defaultValue={assigneeFilter} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="ALL">Todo el equipo</option>
              {collaborators.map((collaborator) => (
                <option key={collaborator.id} value={collaborator.id}>
                  {collaborator.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">
            Aplicar
          </button>
          <a
            href="/admin/tasks"
            className="rounded-xl border border-zinc-300 px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Limpiar
          </a>
        </form>
      </article>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Tareas recientes</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Puedes cambiar estado, responsable, dificultad, fechas y estrellas desde cada tarjeta.
            </p>
          </div>
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
            {tasks.length} resultado{tasks.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="space-y-3 rounded-xl border border-zinc-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-zinc-900">{task.title}</p>
                    <StatusBadge status={task.status} />
                  </div>
                  <p className="text-xs text-zinc-500">
                    {task.assignee.name} · Objetivo: {formatDate(task.dueDate)}
                  </p>
                  {task.description ? <p className="max-w-3xl text-sm text-zinc-600">{task.description}</p> : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                      Cliente: {taskClientLabel(task.client)}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                      Dificultad: {task.difficulty === "EASY" ? "Facil" : task.difficulty === "MEDIUM" ? "Media" : "Dificil"}
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                      Estrellas: {task.starValue}
                    </span>
                    {task.expectedDoneAt ? (
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                        Estimada: {formatDate(task.expectedDoneAt)}
                      </span>
                    ) : null}
                    {task.difficultyLabel ? (
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">
                        Etiqueta: {task.difficultyLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusSelectForm taskId={task.id} status={task.status} />
                  <DeleteTaskButton taskId={task.id} />
                </div>
              </div>

              <form action={updateTaskDatesByAdminAction} className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-[minmax(160px,1fr)_140px_160px_minmax(180px,1fr)_minmax(180px,1fr)_120px_minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-end">
                <input type="hidden" name="taskId" value={task.id} />
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Asignada a</label>
                  <select
                    name="assigneeId"
                    defaultValue={task.assigneeId}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  >
                    {collaborators.map((collaborator) => (
                      <option key={collaborator.id} value={collaborator.id}>
                        {collaborator.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Cliente</label>
                  <select
                    name="client"
                    defaultValue={task.client ?? "SCIO"}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  >
                    {clientOptions.map((client) => (
                      <option key={client} value={client}>
                        {taskClientLabel(client)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Dificultad</label>
                  <select
                    name="difficulty"
                    defaultValue={task.difficulty}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="EASY">Facil</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HARD">Dificil</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Etiqueta dificultad</label>
                  <input
                    name="difficultyLabel"
                    defaultValue={task.difficultyLabel || ""}
                    placeholder="Ej. Jefe Maestro / Retador"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Comienzo</label>
                  <input
                    type="datetime-local"
                    name="startedAt"
                    defaultValue={toDateTimeLocal(task.startedAt)}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Estrellas</label>
                  <input
                    name="starValue"
                    type="number"
                    min={1}
                    max={5}
                    defaultValue={task.starValue}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Fecha objetivo</label>
                  <input
                    type="datetime-local"
                    name="dueDate"
                    defaultValue={toDateTimeLocal(task.dueDate)}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">Dejalo vacio para quitarla.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Cierre estimado</label>
                  <input
                    type="datetime-local"
                    name="expectedDoneAt"
                    defaultValue={toDateTimeLocal(task.expectedDoneAt)}
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">Sirve para proyectar la barra en el Gantt.</p>
                </div>
                <SubmitButton
                  idleLabel="Guardar cambios"
                  pendingLabel="Guardando..."
                  className="w-full rounded-xl bg-black px-3 py-2 text-sm font-medium text-white md:w-auto disabled:cursor-not-allowed disabled:opacity-70"
                />
              </form>
            </div>
          ))}
          {tasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
              No encontramos tareas con esos filtros. Prueba limpiarlos o crea una nueva arriba.
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
