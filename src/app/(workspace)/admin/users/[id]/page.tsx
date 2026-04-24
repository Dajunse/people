import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { updateCollaboratorProfileAction } from "@/actions/admin-actions";
import { AdminSectionsNav } from "@/components/admin-sections-nav";
import { CollaboratorAppearanceForm } from "@/components/collaborator-appearance-form";
import { PageTitle } from "@/components/page-title";
import { SubmitButton } from "@/components/submit-button";
import { taskClientLabel } from "@/lib/labels";
import { RANK_META, RANK_TIER_VALUES } from "@/lib/reward-system";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";

export default async function AdminUserEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [collaborator, companies, activeClients] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id,
        role: { in: [Role.COLLABORATOR, Role.MANAGER] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        role: true,
        startingRank: true,
        dashboardTone: true,
        avatarPreset: true,
        visibleClients: {
          select: { client: true },
        },
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

  if (!collaborator) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle title="Editar Usuario" subtitle={collaborator.name} />
        <AdminSectionsNav />
        <Link href="/admin/users" className="inline-flex rounded-xl border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
          Volver a usuarios
        </Link>
      </div>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <form action={updateCollaboratorProfileAction} className="space-y-4">
          <input type="hidden" name="collaboratorId" value={collaborator.id} />

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Nombre</label>
              <input
                name="name"
                defaultValue={collaborator.name}
                required
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Correo</label>
              <input
                name="email"
                type="email"
                defaultValue={collaborator.email}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Empresa interna</label>
              <select
                name="company"
                defaultValue={collaborator.company ?? ""}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Sin empresa</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.name}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Rol</label>
              <select
                name="role"
                defaultValue={collaborator.role}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                <option value="COLLABORATOR">Colaborador</option>
                <option value="MANAGER">Lider</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-700">Rango inicial</label>
              <select
                name="startingRank"
                defaultValue={collaborator.startingRank}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                {RANK_TIER_VALUES.map((tier) => (
                  <option key={tier} value={tier}>
                    {RANK_META[tier].icon} {RANK_META[tier].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-zinc-700">Nueva contrasena (opcional)</label>
              <input
                name="password"
                type="password"
                minLength={8}
                placeholder="Minimo 8 caracteres"
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.12em] text-zinc-500">Clientes visibles</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {clientOptions.map((client) => (
                <label key={client} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-sm">
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

          <SubmitButton
            idleLabel="Guardar perfil"
            pendingLabel="Guardando..."
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
          />
        </form>
      </article>

      <article className="rounded-2xl border border-zinc-200 bg-white p-4">
        <CollaboratorAppearanceForm
          collaboratorId={collaborator.id}
          dashboardTone={collaborator.dashboardTone}
          avatarPreset={collaborator.avatarPreset}
        />
      </article>
    </section>
  );
}
