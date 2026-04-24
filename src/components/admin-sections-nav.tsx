"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/tasks", label: "Tareas" },
  { href: "/admin/catalogs", label: "Catalogos" },
  { href: "/admin/rewards", label: "Sistema de recompensas" },
];

export function AdminSectionsNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-xl border px-3 py-1.5 text-sm transition ${
              active
                ? "border-black bg-black text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
