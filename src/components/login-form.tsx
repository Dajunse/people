"use client";

import { useActionState } from "react";
import { loginAction } from "@/actions/auth-actions";

const initialState = { error: undefined as string | undefined };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm text-zinc-300">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          placeholder="admin@people.local"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm text-zinc-300">
          Contrasena
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          placeholder="********"
        />
      </div>
      {state.error ? <p className="text-sm text-rose-300">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[20px] bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-100 disabled:opacity-60"
      >
        {pending ? "Ingresando..." : "Iniciar sesion"}
      </button>
    </form>
  );
}
