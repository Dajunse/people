import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "People Workspace",
  description: "Panel de tareas colaborativas para el equipo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
