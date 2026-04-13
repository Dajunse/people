import Link from "next/link";
import { Role, type User } from "@prisma/client";
import { logoutAction } from "@/actions/auth-actions";
import { roleLabel } from "@/lib/labels";

export function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full bg-zinc-100 p-4 md:p-6">
      <aside className="hidden w-72 shrink-0 rounded-3xl bg-zinc-950 p-5 text-white lg:block">
        <div className="border-b border-zinc-800 pb-4">
          <p className="text-lg font-semibold tracking-tight">Tian Studio People</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-400">{roleLabel(user.role)}</p>
          <p className="mt-1 text-sm text-zinc-200">{user.name}</p>
        </div>

        <nav className="mt-5 space-y-1 text-sm">
          <Link href="/dashboard" className="block rounded-xl px-3 py-2 text-zinc-200 hover:bg-zinc-900">
            Dashboard
          </Link>
          <Link href="/public" className="block rounded-xl px-3 py-2 text-zinc-200 hover:bg-zinc-900">
            Dashboard publico
          </Link>
          <Link href="/public/gantt" className="block rounded-xl px-3 py-2 text-zinc-200 hover:bg-zinc-900">
            Portal Gantt
          </Link>
          {user.role === Role.ADMIN ? (
            <>
              <p className="px-3 pt-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Administracion</p>
              <Link href="/admin/users" className="block rounded-xl px-3 py-2 text-zinc-200 hover:bg-zinc-900">
                Usuarios
              </Link>
              <Link href="/admin/tasks" className="block rounded-xl px-3 py-2 text-zinc-200 hover:bg-zinc-900">
                Tareas
              </Link>
              <Link href="/admin/rewards" className="block rounded-xl px-3 py-2 text-zinc-200 hover:bg-zinc-900">
                Sistema de recompensas
              </Link>
            </>
          ) : null}
        </nav>

        <form action={logoutAction} className="mt-6">
          <button type="submit" className="w-full rounded-xl border border-zinc-700 px-3 py-2 text-left text-sm hover:bg-zinc-900">
            Cerrar sesion
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 rounded-3xl border border-zinc-200 bg-zinc-50 p-5 md:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-200 bg-white p-3 lg:hidden">
          <div>
            <p className="text-sm font-semibold text-zinc-900">{user.name}</p>
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">{roleLabel(user.role)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
              Dashboard
            </Link>
            <Link href="/public" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
              Publico
            </Link>
            <Link href="/public/gantt" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
              Gantt
            </Link>
            {user.role === Role.ADMIN ? (
              <>
                <Link href="/admin/users" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
                  Usuarios
                </Link>
                <Link href="/admin/tasks" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
                  Tareas
                </Link>
                <Link href="/admin/rewards" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
                  Recompensas
                </Link>
              </>
            ) : null}
            <form action={logoutAction}>
              <button type="submit" className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700">
                Salir
              </button>
            </form>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
