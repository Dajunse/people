import Link from "next/link";
import { TaskStatus } from "@prisma/client";
import { getAvatarPreset } from "@/lib/avatar-presets";
import { getDashboardTone } from "@/lib/dashboard-tones";
import { prisma } from "@/lib/prisma";
import { calculateRankProgress, RANK_META } from "@/lib/reward-system";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function TaskStars({ value }: { value: number }) {
  const count = Math.max(1, Math.min(5, Math.trunc(value || 1)));

  return (
    <div className="mt-4 flex items-center gap-2 border-t border-white/12 pt-3">
      <div className="flex items-center gap-0.5 text-[11px] leading-none text-amber-300" aria-label={`${count} estrellas`}>
        {Array.from({ length: count }, (_, index) => (
          <span key={index} aria-hidden="true">
            {"\u2B50"}
          </span>
        ))}
      </div>
      <span className="text-[11px] text-white/70">{count} estrella{count === 1 ? "" : "s"}</span>
    </div>
  );
}

export default async function PublicDashboardPage() {
  const [collaborators, settingsRecord] = await Promise.all([
    prisma.user.findMany({
      where: { role: "COLLABORATOR", isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        dashboardTone: true,
        avatarPreset: true,
        startingRank: true,
        assignedTasks: {
          where: {
            status: {
              in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.ALMOST_DONE],
            },
          },
          orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
          take: 6,
          select: {
            id: true,
            title: true,
            description: true,
            startedAt: true,
            dueDate: true,
            status: true,
            starValue: true,
          },
        },
      },
    }),
    prisma.rewardSettings.findUnique({ where: { id: "default" } }),
  ]);

  const rewardSettings = settingsRecord ?? { starsPerWeekTarget: 5, weeksRequiredPerRank: 2 };
  const completedTasks = collaborators.length
    ? await prisma.task.findMany({
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
      })
    : [];

  const completedByUser = new Map<string, Array<{ createdAt: Date; completedAt: Date | null; starValue: number }>>();
  for (const task of completedTasks) {
    const current = completedByUser.get(task.assigneeId) ?? [];
    current.push({ createdAt: task.createdAt, completedAt: task.completedAt, starValue: task.starValue });
    completedByUser.set(task.assigneeId, current);
  }

  const activeTasksCount = collaborators.reduce((acc, collaborator) => {
    const hasActive = collaborator.assignedTasks.some(
      (task) =>
        task.status === TaskStatus.IN_PROGRESS ||
        task.status === TaskStatus.ALMOST_DONE,
    );
    return acc + (hasActive ? 1 : 0);
  }, 0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#11121c_0%,#060608_45%,#030304_100%)] px-6 py-8 text-white">
      <div className="mx-auto w-full max-w-[1750px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-zinc-800 bg-black/40 p-4 backdrop-blur-sm">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">People Dashboard Publico</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Estado actual del equipo</h1>
            <p className="text-sm text-zinc-400">
              Cada columna muestra en que tarea esta trabajando cada ingeniero ahora mismo.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href="/public/gantt"
                className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
              >
                Ver portal Gantt
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Ingenieros</p>
              <p className="mt-1 text-2xl font-semibold text-white">{collaborators.length}</p>
            </div>
            <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Activos</p>
              <p className="mt-1 text-2xl font-semibold text-white">{activeTasksCount}</p>
            </div>
            </div>
          </div>
        </header>

        <section className="overflow-x-auto pb-2">
          <div className="grid min-w-max auto-cols-[360px] grid-flow-col gap-5">
            {collaborators.map((collaborator) => {
              const tone = getDashboardTone(collaborator.dashboardTone);
              const avatar = getAvatarPreset(collaborator.avatarPreset);
              const progress = calculateRankProgress(
                completedByUser.get(collaborator.id) ?? [],
                rewardSettings,
                collaborator.startingRank,
              );
              const rankMeta = RANK_META[progress.rank];
              const currentTask =
                collaborator.assignedTasks.find(
                  (task) =>
                    task.status === TaskStatus.IN_PROGRESS ||
                    task.status === TaskStatus.ALMOST_DONE,
                ) ?? null;
              const queue = collaborator.assignedTasks.filter(
                (task) => task.id !== currentTask?.id,
              );

              return (
                <article
                  key={collaborator.id}
                  className={`relative overflow-hidden rounded-[30px] border p-4 shadow-[0_18px_48px_-18px_rgba(0,0,0,0.85)] ${tone.frame}`}
                >
                  <div className="pointer-events-none absolute inset-0 bg-black/18" />
                  <div className="relative z-10 mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-gradient-to-br text-xl ${avatar.swatch}`}>
                        {avatar.emoji}
                      </span>
                      <div>
                        <p className={`text-xs uppercase tracking-[0.14em] ${tone.heading}`}>Ingeniero</p>
                        <h2 className={`text-xl font-semibold ${tone.title}`}>{collaborator.name}</h2>
                        <p className="text-[11px] text-white/80">
                          {rankMeta.icon} {rankMeta.label} - Estrellas {progress.currentWeekStars}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${tone.chip}`}>
                      <span className="mr-1" aria-hidden="true">
                        {currentTask ? "\u{1F6E0}\uFE0F" : "\u{1F634}"}
                      </span>
                      {currentTask ? "Trabajando" : "Disponible"}
                    </span>
                  </div>

                  {currentTask ? (
                    <div className="relative z-10 space-y-3">
                      <div className={`rounded-3xl border p-4 ${tone.primary}`}>
                        <div>
                          <p className={`text-xs uppercase tracking-[0.14em] ${tone.heading}`}>Tarea actual</p>
                          <p className={`mt-1 text-base font-semibold ${tone.title}`}>{currentTask.title}</p>
                          {currentTask.description ? (
                            <p className={`mt-1 text-sm ${tone.body}`}>{currentTask.description}</p>
                          ) : null}
                        </div>
                        <TaskStars value={currentTask.starValue} />
                      </div>

                      <div className="grid gap-2 md:grid-cols-2">
                        <div className={`rounded-2xl border p-3 ${tone.soft}`}>
                          <p className={`text-[11px] uppercase tracking-[0.1em] ${tone.heading}`}>Comenzo</p>
                          <p className={`mt-1 text-xs font-medium ${tone.title}`}>
                            {formatDateTime(currentTask.startedAt)}
                          </p>
                        </div>
                        {currentTask.dueDate ? (
                          <div className={`rounded-2xl border p-3 ${tone.soft}`}>
                            <p className={`text-[11px] uppercase tracking-[0.1em] ${tone.heading}`}>Meta</p>
                            <p className={`mt-1 text-xs font-medium ${tone.title}`}>
                              {formatDateTime(currentTask.dueDate)}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="relative z-10 rounded-3xl border border-dashed border-white/35 bg-black/20 p-4">
                      <p className={`text-sm ${tone.muted}`}>Sin tarea activa en este momento.</p>
                    </div>
                  )}

                  {queue.length > 0 ? (
                    <div className="relative z-10 mt-4 rounded-3xl border border-white/25 bg-black/20 p-3">
                      <p className={`text-xs uppercase tracking-[0.14em] ${tone.heading}`}>Cola de actividades</p>
                      <div className="mt-2 space-y-2">
                        {queue.map((task, queueIndex) => (
                          <div
                            key={task.id}
                            className={`rounded-2xl border p-2.5 ${tone.queue[queueIndex % tone.queue.length]}`}
                          >
                            <div>
                              <p className="text-sm font-medium text-white">{task.title}</p>
                              {task.dueDate ? (
                                <p className="mt-1 text-xs text-white/80">
                                  Objetivo: {formatDateTime(task.dueDate)}
                                </p>
                              ) : null}
                            </div>
                            <TaskStars value={task.starValue} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

