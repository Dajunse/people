import { Role, TaskStatus } from "@prisma/client";
import { updateTaskProgressAction } from "@/actions/task-actions";
import { PageTitle } from "@/components/page-title";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateRankProgress, RANK_META, RANK_ORDER } from "@/lib/reward-system";
import { formatDate, formatDateTime } from "@/lib/utils";

function actionForStatus(status: TaskStatus) {
  if (status === TaskStatus.PENDING) {
    return { actionType: "START", label: "Comenzar" };
  }
  if (status === TaskStatus.IN_PROGRESS) {
    return { actionType: "ALMOST_DONE", label: "Creo tenerla lista" };
  }
  if (status === TaskStatus.ALMOST_DONE) {
    return { actionType: "COMPLETE", label: "Finalizar" };
  }
  return null;
}

export default async function DashboardPage() {
  const user = await requireUser();

  const [tasks, collaborators, completedHistory, myCompleted, settingsRecord, activeRewards] = await Promise.all([
    prisma.task.findMany({
      include: {
        assignee: true,
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 60,
    }),
    prisma.user.findMany({
      where: { role: { in: [Role.COLLABORATOR, Role.MANAGER] }, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.taskHistory.findMany({
      where: { action: "COMPLETED" },
      include: {
        user: true,
        task: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        assigneeId: user.id,
        status: TaskStatus.COMPLETED,
      },
      include: { assignee: true },
      orderBy: { completedAt: "desc" },
      take: 12,
    }),
    prisma.rewardSettings.findUnique({ where: { id: "default" } }),
    prisma.reward.findMany({
      where: { isActive: true },
      orderBy: [{ minRank: "asc" }, { createdAt: "desc" }],
      take: 12,
    }),
  ]);
  const rewardSettings = settingsRecord ?? { starsPerWeekTarget: 5, weeksRequiredPerRank: 2 };
  const completedForRanking = await prisma.task.findMany({
    where: {
      assigneeId: { in: collaborators.map((collaborator) => collaborator.id) },
      status: TaskStatus.COMPLETED,
      completedAt: { not: null },
    },
    select: {
      assigneeId: true,
      createdAt: true,
      completedAt: true,
      starValue: true,
    },
  });
  const completedByUserMap = new Map<string, Array<{ createdAt: Date; completedAt: Date | null; starValue: number }>>();
  for (const task of completedForRanking) {
    const current = completedByUserMap.get(task.assigneeId) ?? [];
    current.push({ createdAt: task.createdAt, completedAt: task.completedAt, starValue: task.starValue });
    completedByUserMap.set(task.assigneeId, current);
  }
  const progressByUser = new Map(
    collaborators.map((collaborator) => [
      collaborator.id,
      calculateRankProgress(
        completedByUserMap.get(collaborator.id) ?? [],
        rewardSettings,
        collaborator.startingRank,
      ),
    ]),
  );
  const myProgress = progressByUser.get(user.id) ?? calculateRankProgress([], rewardSettings, user.startingRank);
  const unlockedRewards = activeRewards.filter(
    (reward) => RANK_ORDER.indexOf(reward.minRank) <= RANK_ORDER.indexOf(myProgress.rank),
  );

  const grouped = {
    [TaskStatus.PENDING]: tasks.filter((task) => task.status === TaskStatus.PENDING),
    [TaskStatus.IN_PROGRESS]: tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS),
    [TaskStatus.ALMOST_DONE]: tasks.filter((task) => task.status === TaskStatus.ALMOST_DONE),
    [TaskStatus.COMPLETED]: tasks.filter((task) => task.status === TaskStatus.COMPLETED),
  };

  const completedByUser = collaborators.map((collaborator) => ({
    id: collaborator.id,
    name: collaborator.name,
    rank: progressByUser.get(collaborator.id)?.rank ?? RANK_ORDER[0],
    stars: progressByUser.get(collaborator.id)?.currentWeekStars ?? 0,
    total: completedByUserMap.get(collaborator.id)?.length ?? 0,
  }));

  return (
    <section className="space-y-6">
      <PageTitle
        title="Dashboard del equipo"
        subtitle="Vista compartida para saber quien esta trabajando en cada tarea."
      />

      <div className="grid gap-3 md:grid-cols-4">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Pendientes</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{grouped.PENDING.length}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">En progreso</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{grouped.IN_PROGRESS.length}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Casi listas</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{grouped.ALMOST_DONE.length}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Completadas</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{grouped.COMPLETED.length}</p>
        </article>
      </div>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Tablero compartido</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Todos ven el estado. El colaborador asignado (o admin) actualiza el avance.
        </p>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {tasks.map((task) => {
            const canManage = user.role === Role.ADMIN || task.assigneeId === user.id;
            const nextAction = actionForStatus(task.status);

            return (
              <div key={task.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-zinc-900">{task.title}</p>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-1 text-sm text-zinc-600">{task.description || "Sin descripcion."}</p>
                <div className="mt-2 text-xs text-zinc-500">
                  <p>Asignada a: {task.assignee.name}</p>
                  <p>Fecha objetivo: {formatDate(task.dueDate)}</p>
                  <p>Comenzo: {formatDateTime(task.startedAt)}</p>
                  <p>Casi lista: {formatDateTime(task.almostDoneAt)}</p>
                  <p>Finalizo: {formatDateTime(task.completedAt)}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canManage && nextAction ? (
                    <form action={updateTaskProgressAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="actionType" value={nextAction.actionType} />
                      <button
                        type="submit"
                        className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-100"
                      >
                        {nextAction.label}
                      </button>
                    </form>
                  ) : null}

                  {user.role === Role.ADMIN && task.status === TaskStatus.COMPLETED ? (
                    <form action={updateTaskProgressAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="actionType" value="REOPEN" />
                      <button
                        type="submit"
                        className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-100"
                      >
                        Reabrir
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}

          {tasks.length === 0 ? (
            <p className="text-sm text-zinc-500">Aun no hay tareas creadas.</p>
          ) : null}
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Historial por colaborador</h2>
          <div className="mt-3 space-y-2">
            {completedByUser.map((collaborator) => (
              <div key={collaborator.id} className="flex items-center justify-between rounded-xl border border-zinc-200 p-3">
                <div>
                  <p className="text-sm text-zinc-700">{collaborator.name}</p>
                  <p className="text-xs text-zinc-500">
                    {RANK_META[collaborator.rank].icon} {RANK_META[collaborator.rank].label} - Estrellas {collaborator.stars}/semana
                  </p>
                </div>
                <p className="text-sm font-semibold text-zinc-900">{collaborator.total} completadas</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Mis tareas terminadas</h2>
          <div className="mt-3 space-y-2">
            {myCompleted.map((task) => (
              <div key={task.id} className="rounded-xl border border-zinc-200 p-3">
                <p className="text-sm font-medium text-zinc-900">{task.title}</p>
                <p className="text-xs text-zinc-500">Finalizada: {formatDateTime(task.completedAt)}</p>
              </div>
            ))}
            {myCompleted.length === 0 ? (
              <p className="text-sm text-zinc-500">Aun no tienes tareas finalizadas.</p>
            ) : null}
          </div>
        </article>
      </div>

      {unlockedRewards.length > 0 ? (
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Sistema de recompensas</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Tu rango actual: {RANK_META[myProgress.rank].icon} {RANK_META[myProgress.rank].label} - Estrellas {myProgress.currentWeekStars} esta semana
          </p>
          <div className="mt-3 space-y-2">
            {unlockedRewards.map((reward) => (
                <div key={reward.id} className="rounded-xl border border-zinc-200 p-3">
                  <p className="text-sm font-medium text-zinc-900">{reward.title}</p>
                  <p className="text-xs text-zinc-500">
                    Requiere: {RANK_META[reward.minRank].icon} {RANK_META[reward.minRank].label}
                  </p>
                  {reward.description ? <p className="mt-1 text-sm text-zinc-700">{reward.description}</p> : null}
                </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Actividad reciente del equipo</h2>
        <div className="mt-3 space-y-2">
          {completedHistory.map((item) => (
            <div key={item.id} className="rounded-xl border border-zinc-200 p-3">
              <p className="text-sm text-zinc-800">
                <span className="font-semibold">{item.user.name}</span> completo{" "}
                <span className="font-semibold">{item.task.title}</span>
              </p>
              <p className="text-xs text-zinc-500">{formatDateTime(item.createdAt)}</p>
            </div>
          ))}
          {completedHistory.length === 0 ? (
            <p className="text-sm text-zinc-500">Todavia no hay finalizaciones registradas.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}

