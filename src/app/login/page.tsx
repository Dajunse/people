import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/public/gantt");
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-zinc-950 px-6">
      <section className="w-full max-w-md space-y-6 rounded-[28px] border border-zinc-800 bg-black p-6 shadow-[0_20px_56px_rgba(0,0,0,0.55)]">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">People Workspace</p>
          <h1 className="text-2xl font-semibold text-white">Inicia sesion</h1>
          <p className="text-sm text-zinc-400">Panel compartido para coordinar tareas del equipo.</p>
        </div>
        <LoginForm />
        <div className="space-y-2 text-center text-sm">
          <Link
            href="/public"
            className="block text-zinc-400 underline underline-offset-4 transition hover:text-zinc-200"
          >
            Ver dashboard publico
          </Link>
          <Link
            href="/public/gantt"
            className="block text-zinc-500 underline underline-offset-4 transition hover:text-zinc-200"
          >
            Ver portal Gantt publico
          </Link>
        </div>
      </section>
    </main>
  );
}
