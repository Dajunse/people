export const TASK_CLIENT_VALUES = [
  "SCIO",
  "MAQUEX",
  "HULMEC",
  "BLAIR",
  "NEWELL",
  "ORBIT",
] as const;

export type TaskClientValue = (typeof TASK_CLIENT_VALUES)[number];

export const TASK_CLIENT_LABELS: Record<TaskClientValue, string> = {
  SCIO: "SCIO",
  MAQUEX: "MAQUEX",
  HULMEC: "HULMEC",
  BLAIR: "BLAIR",
  NEWELL: "NEWELL",
  ORBIT: "ORBIT",
};
