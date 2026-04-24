# People Workspace

Sistema interno para coordinar tareas entre colaboradores con dos vistas:

- `Admin`: crea colaboradores y asigna tareas.
- `Dashboard compartido`: todos ven el avance del equipo y cada responsable actualiza su tarea.

## Flujo de tareas

Cada tarea pasa por estos estados:

1. `Pendiente`
2. `En progreso` (boton: **Comenzar**)
3. `Casi lista` (boton: **Creo tenerla lista**)
4. `Completada` (boton: **Finalizar**)

El dashboard tambien muestra historial de completadas por colaborador.

## Stack

- Next.js 16
- TypeScript
- Tailwind CSS
- Prisma
- SQLite (local dev)
- Auth por sesion segura con cookie HttpOnly

## Instalacion local

```bash
npm install
npx prisma migrate dev
npm run prisma:seed
npm run dev
```

## Credenciales de prueba

- Admin:
  - `admin@people.local`
  - `Admin12345!`
- Colaborador:
  - `alice@people.local`
  - `Colab12345!`
- Colaborador:
  - `diego@people.local`
  - `Colab12345!`

## Rutas principales

- `/login`
- `/dashboard` (compartido)
- `/admin` (solo admin)

## Scripts utiles

- `npm run dev`
- `npm run lint`
- `npm run build`
- `npm run prisma:migrate`
- `npm run prisma:seed`

<!-- Railway redeploy marker: 2026-04-24 -->
