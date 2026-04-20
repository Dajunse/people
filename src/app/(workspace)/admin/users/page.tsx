import { Role } from "@prisma/client";
import { createCollaboratorAction, updateCollaboratorProfileAction } from "@/actions/admin-actions";
import { AdminSectionsNav } from "@/components/admin-sections-nav";
import { CollaboratorAppearanceForm } from "@/components/collaborator-appearance-form";
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

  const collaborators = await prisma.user.findMany({
    where: { role: { in: [Role.COLLABORATOR, Role.MANAGER] }, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      primaryClient: true,
      dashboardTone: true,
      avatarPreset: true,
      startingRank: true,
      visibleClients: {
        select: { client: true },
      },
    },
  });
  const personalizedRanks = collaborators.filter((collaborator) => collaborator.startingRank !== "IRON").length;

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle
          title="Administracion de Usuarios"
          subtitle="Gestiona colaboradores, apariencia y datos de acceso."
        />
        <AdminSectionsNav />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Usuarios activos</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{collaborators.length}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Temas disponibles</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{DASHBOARD_TONE_OPTIONS.length}</p>
        </article>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Rangos iniciales ajustados</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-900">{personalizedRanks}</p>
        </article>
      </div>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Nuevo usuario</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Crea una cuenta lista para entrar al dashboard y personaliza su tarjeta desde el inicio.
            </p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Alta rapida
          </span>
        </div>
        <form action={createCollaboratorAction} className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Nombre</label>
            <input name="name" required className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Correo</label>
            <input name="email" type="email" required className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Contrasena temporal</label>
            <input name="password" type="password" required className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
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
            <label className="mb-1 block text-sm text-zinc-700">Rol</label>
            <select name="role" required defaultValue="COLLABORATOR" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="COLLABORATOR">Colaborador</option>
              <option value="MANAGER">Lider</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-700">Empresa a la que pertenece</label>
            <select name="primaryClient" required defaultValue="SCIO" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              {TASK_CLIENT_VALUES.map((client) => (
                <option key={client} value={client}>
                  {taskClientLabel(client)}
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
            <label className="mb-1 block text-sm text-zinc-700">Empresas visibles</label>
            <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 sm:grid-cols-3">
              {TASK_CLIENT_VALUES.map((client) => (
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
        <h2 className="text-lg font-semibold text-zinc-900">Apariencia por colaborador</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Tema y avatar se guardan automaticamente al seleccionar. Perfil y acceso se editan en la misma tarjeta.
        </p>
        <div className="mt-3 space-y-3">
          {collaborators.map((collaborator) => (
            <div key={collaborator.id} className="space-y-2 rounded-xl border border-zinc-200 p-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-semibold text-zinc-900">{collaborator.name}</p>
                <span className="text-xs text-zinc-400">-</span>
                <p className="text-xs text-zinc-600">{collaborator.email}</p>
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                  {collaborator.role === Role.MANAGER ? "Lider" : "Colaborador"} · {taskClientLabel(collaborator.primaryClient)}
                </span>
                <div className="ml-auto">
                  <DeleteCollaboratorButton collaboratorId={collaborator.id} />
                </div>
              </div>
              <form
                action={updateCollaboratorProfileAction}
                className="grid gap-2 rounded-xl border border-zinc-200 p-2 md:grid-cols-[minmax(120px,1fr)_minmax(220px,1.4fr)_minmax(150px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(150px,1fr)_auto] md:items-center"
              >
                <input type="hidden" name="collaboratorId" value={collaborator.id} />
                <div>
                  <input
                    name="name"
                    defaultValue={collaborator.name}
                    aria-label="Nombre"
                    required
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <input
                    name="email"
                    type="email"
                    defaultValue={collaborator.email}
                    aria-label="Correo"
                    required
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <input
                    name="password"
                    type="password"
                    aria-label="Nueva contrasena (opcional)"
                    minLength={8}
                    placeholder="Nueva contrasena (opcional)"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <select
                    name="role"
                    defaultValue={collaborator.role}
                    aria-label="Rol"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="COLLABORATOR">Colaborador</option>
                    <option value="MANAGER">Lider</option>
                  </select>
                </div>
                <div>
                  <select
                    name="primaryClient"
                    defaultValue={collaborator.primaryClient ?? "SCIO"}
                    aria-label="Empresa principal"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  >
                    {TASK_CLIENT_VALUES.map((client) => (
                      <option key={client} value={client}>
                        {taskClientLabel(client)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    name="startingRank"
                    defaultValue={collaborator.startingRank}
                    aria-label="Rango inicial"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                  >
                    {RANK_TIER_VALUES.map((tier) => (
                      <option key={tier} value={tier}>
                        {RANK_META[tier].icon} {RANK_META[tier].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <SubmitButton
                    idleLabel="Guardar"
                    pendingLabel="Guardando..."
                    className="w-full rounded-xl bg-black px-3 py-2 text-sm font-medium text-white md:w-auto disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </div>
                <div className="md:col-span-7">
                  <p className="mb-1 text-xs uppercase tracking-[0.12em] text-zinc-500">Empresas visibles</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {TASK_CLIENT_VALUES.map((client) => (
                      <label key={`${collaborator.id}-${client}`} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-sm">
                        <input
                          type="checkbox"
                          name="visibleClients"
                          value={client}
                          defaultChecked={collaborator.visibleClients.some((item) => item.client === client)}
                        />
                        <span>{taskClientLabel(client)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </form>
              <CollaboratorAppearanceForm
                collaboratorId={collaborator.id}
                dashboardTone={collaborator.dashboardTone}
                avatarPreset={collaborator.avatarPreset}
              />
            </div>
          ))}
          {collaborators.length === 0 ? (
            <p className="text-sm text-zinc-500">No hay colaboradores activos para personalizar.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}
