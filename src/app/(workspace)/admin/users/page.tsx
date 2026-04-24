import Link from "next/link";
import { Role } from "@prisma/client";
import { createCollaboratorAction } from "@/actions/admin-actions";
import { AdminSectionsNav } from "@/components/admin-sections-nav";
import { DeleteCollaboratorButton } from "@/components/delete-collaborator-button";
import { PageTitle } from "@/components/page-title";
import { SubmitButton } from "@/components/submit-button";
import { AVATAR_PRESET_OPTIONS } from "@/lib/avatar-presets";
import { DASHBOARD_TONE_OPTIONS } from "@/lib/dashboard-tones";
import { taskClientLabel } from "@/lib/labels";
import { RANK_META, RANK_TIER_VALUES } from "@/lib/reward-system";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";

export default async function AdminUsersPage() {
  await requireAdmin();

  const [collaborators, companies, activeClients] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.COLLABORATOR, Role.MANAGER] }, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        role: true,
      },
    }),
    prisma.company.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.client.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);
  const clientOptions = activeClients.length > 0 ? activeClients.map((client) => client.name) : [...TASK_CLIENT_VALUES];

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle
          title="Administracion de Usuarios"
          subtitle="Gestiona colaboradores, empresa interna y acceso a clientes."
        />
        <AdminSectionsNav />
      </div>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Nuevo usuario</h2>
            <p className="mt-1 text-sm text-zinc-600">Alta rapida con contrasena temporal autogenerada segura.</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            {collaborators.length} activos
          </span>
        </div>
        <form action={createCollaboratorAction} className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Nombre</label>
            <input name="name" required className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Rol</label>
            <select name="role" required defaultValue="COLLABORATOR" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="COLLABORATOR">Colaborador</option>
              <option value="MANAGER">Lider</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Empresa interna</label>
            <select name="company" defaultValue="" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="">Sin empresa</option>
              {companies.map((company) => (
                <option key={company.id} value={company.name}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Color de tarjeta</label>
            <select name="dashboardTone" required defaultValue="OCEAN" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              {DASHBOARD_TONE_OPTIONS.map((tone) => (
                <option key={tone.value} value={tone.value}>
                  {tone.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Avatar</label>
            <select name="avatarPreset" required defaultValue="ROBOT" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              {AVATAR_PRESET_OPTIONS.map((avatar) => (
                <option key={avatar.value} value={avatar.value}>
                  {avatar.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Rango inicial</label>
            <select name="startingRank" required defaultValue="IRON" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              {RANK_TIER_VALUES.map((tier) => (
                <option key={tier} value={tier}>
                  {RANK_META[tier].icon} {RANK_META[tier].label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm text-zinc-700">Clientes visibles</label>
            <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 sm:grid-cols-3">
              {clientOptions.map((client) => (
                <label key={client} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm">
                  <input type="checkbox" name="visibleClients" value={client} defaultChecked />
                  <span>{taskClientLabel(client)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <SubmitButton
              idleLabel="Guardar colaborador"
              pendingLabel="Guardando colaborador..."
              className="w-fit rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        </form>
      </article>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Usuarios activos</h2>
        <div className="mt-3 space-y-2">
          {collaborators.map((collaborator) => (
            <div key={collaborator.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-3">
              <p className="text-sm font-semibold text-zinc-900">{collaborator.name}</p>
              <span className="text-xs text-zinc-500">{collaborator.email}</span>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                {collaborator.role === Role.MANAGER ? "Lider" : "Colaborador"}
              </span>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                Empresa: {collaborator.company ?? "Sin empresa"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Link
                  href={`/admin/users/${collaborator.id}`}
                  className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  Editar
                </Link>
                <DeleteCollaboratorButton collaboratorId={collaborator.id} />
              </div>
            </div>
          ))}
          {collaborators.length === 0 ? (
            <p className="text-sm text-zinc-500">No hay colaboradores activos.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}
