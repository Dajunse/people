import { Role, TaskStatus } from "@prisma/client";
import { createRewardAction, deleteRewardAction, updateRewardSettingsAction } from "@/actions/admin-actions";
import { AdminSectionsNav } from "@/components/admin-sections-nav";
import { PageTitle } from "@/components/page-title";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateRankProgress, RANK_META, RANK_ORDER, RANK_TIER_VALUES } from "@/lib/reward-system";

const DEFAULT_SETTINGS = {
  starsPerWeekTarget: 5,
  weeksRequiredPerRank: 2,
};

export default async function AdminRewardsPage() {
  await requireAdmin();

  const [settingsRecord, collaborators, rewards] = await Promise.all([
    prisma.rewardSettings.findUnique({ where: { id: "default" } }),
    prisma.user.findMany({
      where: { role: { in: [Role.COLLABORATOR, Role.MANAGER] }, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, startingRank: true },
    }),
    prisma.reward.findMany({
      orderBy: [{ isActive: "desc" }, { minRank: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  const settings = settingsRecord ?? DEFAULT_SETTINGS;

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

  const tasksByUser = new Map<string, Array<{ createdAt: Date; completedAt: Date | null; starValue: number }>>();
  for (const task of completedTasks) {
    const current = tasksByUser.get(task.assigneeId) ?? [];
    current.push({ createdAt: task.createdAt, completedAt: task.completedAt, starValue: task.starValue });
    tasksByUser.set(task.assigneeId, current);
  }

  const leaderboard = collaborators
    .map((collaborator) => {
      const progress = calculateRankProgress(
        tasksByUser.get(collaborator.id) ?? [],
        settings,
        collaborator.startingRank,
      );
      return {
        ...collaborator,
        ...progress,
      };
    })
    .sort((a, b) => {
      const rankDiff = RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank);
      if (rankDiff !== 0) return rankDiff;
      if (b.streakWeeks !== a.streakWeeks) return b.streakWeeks - a.streakWeeks;
      return b.totalStars - a.totalStars;
    });

  const activeRewards = rewards.filter((reward) => reward.isActive);
  const topPerformer = leaderboard[0] ?? null;

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle
          title="Sistema de recompensas"
          subtitle="Configura estrellas, progreso por semanas y recompensas por rango."
        />
        <AdminSectionsNav />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Recompensas activas</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{activeRewards.length}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Meta semanal</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{settings.starsPerWeekTarget}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Lider actual</p>
          <p className="mt-2 text-lg font-semibold text-zinc-900">
            {topPerformer ? `${topPerformer.name} · ${RANK_META[topPerformer.rank].label}` : "Sin datos"}
          </p>
        </article>
      </div>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Reglas del sistema</h2>
        <form action={updateRewardSettingsAction} className="mt-3 grid gap-3 md:grid-cols-3 md:items-end">
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Estrellas objetivo por semana</label>
            <input
              name="starsPerWeekTarget"
              type="number"
              min={1}
              max={100}
              defaultValue={settings.starsPerWeekTarget}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Semanas para subir un rango</label>
            <input
              name="weeksRequiredPerRank"
              type="number"
              min={1}
              max={52}
              defaultValue={settings.weeksRequiredPerRank}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
            />
          </div>
          <SubmitButton
            idleLabel="Guardar reglas"
            pendingLabel="Guardando reglas..."
            className="w-full rounded-xl bg-black px-4 py-2 text-sm font-medium text-white md:w-auto disabled:cursor-not-allowed disabled:opacity-70"
          />
        </form>
      </article>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Nueva recompensa</h2>
        <form action={createRewardAction} className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm text-zinc-700">Titulo</label>
            <input
              name="title"
              required
              placeholder="Ej. Vale de comida, dia libre, bonus, etc."
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Rango minimo</label>
            <select name="minRank" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              {RANK_TIER_VALUES.map((tier) => (
                <option key={tier} value={tier}>
                  {RANK_META[tier].label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-sm text-zinc-700">Descripcion (opcional)</label>
            <textarea name="description" rows={2} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </div>
          <div className="md:col-span-3">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="isActive" value="1" defaultChecked />
              Activa
            </label>
          </div>
          <div className="md:col-span-3">
            <SubmitButton
              idleLabel="Crear recompensa"
              pendingLabel="Creando recompensa..."
              className="w-fit rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        </form>
      </article>

      {activeRewards.length > 0 ? (
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Recompensas activas</h2>
          <div className="mt-3 space-y-2">
            {activeRewards.map((reward) => (
              <div key={reward.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3">
                <div>
                  <p className="font-medium text-zinc-900">{reward.title}</p>
                  <p className="text-xs text-zinc-500">
                    Minimo: {RANK_META[reward.minRank].icon} {RANK_META[reward.minRank].label}
                  </p>
                  {reward.description ? <p className="mt-1 text-sm text-zinc-700">{reward.description}</p> : null}
                </div>
                <form action={deleteRewardAction}>
                  <input type="hidden" name="rewardId" value={reward.id} />
                  <SubmitButton
                    idleLabel="Eliminar"
                    pendingLabel="Eliminando..."
                    className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </form>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Ranking semanal</h2>
        <p className="mt-1 text-sm text-zinc-600">
          La tarea suma sus estrellas configuradas (1 a 5) cuando se completa en 7 dias o menos.
        </p>
        <div className="mt-3 space-y-2">
          {leaderboard.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 p-3">
              <div>
                <p className="font-medium text-zinc-900">{item.name}</p>
                <p className="text-xs text-zinc-500">{item.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs ${RANK_META[item.rank].chip}`}>
                  {RANK_META[item.rank].icon} {RANK_META[item.rank].label}
                </span>
                <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">
                  Estrellas semana: {item.currentWeekStars}
                </span>
                <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">
                  Racha: {item.streakWeeks}
                </span>
              </div>
            </div>
          ))}
          {leaderboard.length === 0 ? (
            <p className="text-sm text-zinc-500">No hay colaboradores activos.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}

