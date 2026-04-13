import { TaskStatus } from "@prisma/client";
import { taskStatusLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

const toneMap: Record<TaskStatus, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-700",
  IN_PROGRESS: "border-blue-300 bg-blue-50 text-blue-700",
  ALMOST_DONE: "border-violet-300 bg-violet-50 text-violet-700",
  COMPLETED: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        toneMap[status],
      )}
    >
      {taskStatusLabel(status)}
    </span>
  );
}
