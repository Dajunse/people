import Link from "next/link";
import {
  activateClientAction,
  activateCompanyAction,
  createClientAction,
  createCompanyAction,
  deleteClientAction,
  deleteClientPermanentAction,
  deleteCompanyAction,
  deleteCompanyPermanentAction,
  updateClientAction,
  updateCompanyAction,
} from "@/actions/admin-actions";
import { AdminSectionsNav } from "@/components/admin-sections-nav";
import { PageTitle } from "@/components/page-title";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TASK_CLIENT_VALUES } from "@/lib/task-clients";

function firstValue(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function AdminCatalogsPage({
  searchParams,
}: {
  searchParams?: Promise<{ editCompany?: string | string[]; editClient?: string | string[] }>;
}) {
  await requireAdmin();

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const editCompanyId = firstValue(resolvedSearchParams.editCompany) ?? "";
  const editClientId = firstValue(resolvedSearchParams.editClient) ?? "";

  const legacyCompanies = await prisma.user.findMany({
    where: {
      company: {
        not: null,
      },
    },
    select: {
      company: true,
    },
    distinct: ["company"],
  });

  const [clientCount, companyCount] = await Promise.all([
    prisma.client.count(),
    prisma.company.count(),
  ]);

  if (clientCount === 0) {
    await prisma.client.createMany({
      data: TASK_CLIENT_VALUES.map((name) => ({
        name,
        isActive: true,
      })),
    });
  }

  if (companyCount === 0) {
    const bootstrapCompanies = legacyCompanies
      .map((entry) => entry.company?.trim())
      .filter((name): name is string => Boolean(name));

    if (bootstrapCompanies.length > 0) {
      await prisma.company.createMany({
        data: bootstrapCompanies.map((name) => ({
          name,
          isActive: true,
        })),
      });
    }
  }

  const [companies, clients] = await Promise.all([
    prisma.company.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.client.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
  ]);

  const editingCompany = companies.find((company) => company.id === editCompanyId) ?? null;
  const editingClient = clients.find((client) => client.id === editClientId) ?? null;

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <PageTitle title="Catalogos" subtitle="Administra empresas internas y clientes externos." />
        <AdminSectionsNav />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Empresas internas</h2>
          <form action={createCompanyAction} className="mt-3 flex gap-2">
            <input
              name="name"
              required
              placeholder="Ej. Operaciones"
              className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
            <SubmitButton
              idleLabel="Agregar"
              pendingLabel="Guardando..."
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
            />
          </form>
          <div className="mt-3 space-y-2">
            {companies.map((company) => (
              <div key={company.id} className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{company.name}</p>
                  <p className="text-xs text-zinc-500">{company.isActive ? "Activa" : "Inactiva"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {company.isActive ? (
                    <form action={deleteCompanyAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <button type="submit" className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50">
                        Desactivar
                      </button>
                    </form>
                  ) : (
                    <form action={activateCompanyAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <button type="submit" className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                        Activar
                      </button>
                    </form>
                  )}
                  <Link
                    href={`/admin/catalogs?editCompany=${company.id}`}
                    className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    Editar
                  </Link>
                  <form action={deleteCompanyPermanentAction}>
                    <input type="hidden" name="companyId" value={company.id} />
                    <button type="submit" className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50">
                      Eliminar
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Clientes</h2>
          <form action={createClientAction} className="mt-3 flex gap-2">
            <input
              name="name"
              required
              placeholder="Ej. Cliente Norte"
              className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
            <SubmitButton
              idleLabel="Agregar"
              pendingLabel="Guardando..."
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
            />
          </form>
          <div className="mt-3 space-y-2">
            {clients.map((client) => (
              <div key={client.id} className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{client.name}</p>
                  <p className="text-xs text-zinc-500">{client.isActive ? "Activo" : "Inactivo"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {client.isActive ? (
                    <form action={deleteClientAction}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <button type="submit" className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50">
                        Desactivar
                      </button>
                    </form>
                  ) : (
                    <form action={activateClientAction}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <button type="submit" className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                        Activar
                      </button>
                    </form>
                  )}
                  <Link
                    href={`/admin/catalogs?editClient=${client.id}`}
                    className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    Editar
                  </Link>
                  <form action={deleteClientPermanentAction}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <button type="submit" className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50">
                      Eliminar
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      {editingCompany ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <Link href="/admin/catalogs" className="absolute inset-0" aria-label="Cerrar modal de empresa" />
          <section className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">Editar empresa</h3>
              <Link href="/admin/catalogs" className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm text-zinc-700 hover:bg-zinc-50">
                Cerrar
              </Link>
            </div>
            <form action={updateCompanyAction} className="mt-3 flex gap-2">
              <input type="hidden" name="companyId" value={editingCompany.id} />
              <input
                name="name"
                required
                defaultValue={editingCompany.name}
                className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
              <SubmitButton
                idleLabel="Guardar"
                pendingLabel="Guardando..."
                className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
              />
            </form>
          </section>
        </div>
      ) : null}

      {editingClient ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <Link href="/admin/catalogs" className="absolute inset-0" aria-label="Cerrar modal de cliente" />
          <section className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">Editar cliente</h3>
              <Link href="/admin/catalogs" className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm text-zinc-700 hover:bg-zinc-50">
                Cerrar
              </Link>
            </div>
            <form action={updateClientAction} className="mt-3 flex gap-2">
              <input type="hidden" name="clientId" value={editingClient.id} />
              <input
                name="name"
                required
                defaultValue={editingClient.name}
                className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
              <SubmitButton
                idleLabel="Guardar"
                pendingLabel="Guardando..."
                className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
              />
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
