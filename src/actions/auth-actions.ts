"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { destroySession, loginWithPassword } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function loginAction(
  _prevState: { error?: string },
  formData: FormData,
) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Revisa correo y contrasena." };
  }

  const success = await loginWithPassword(parsed.data.email, parsed.data.password);
  if (!success) {
    return { error: "Credenciales invalidas." };
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
