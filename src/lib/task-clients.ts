export const TASK_CLIENT_VALUES = [
  "SCIO",
  "MAQUEX",
  "HULMEC",
  "BLAIR",
  "NEWELL",
  "ORBIT",
] as const;

export const TASK_CLIENT_LABELS: Record<(typeof TASK_CLIENT_VALUES)[number], string> = {
  SCIO: "SCIO",
  MAQUEX: "MAQUEX",
  HULMEC: "HULMEC",
  BLAIR: "BLAIR",
  NEWELL: "NEWELL",
  ORBIT: "ORBIT",
};
