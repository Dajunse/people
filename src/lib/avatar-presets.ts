export const AVATAR_PRESET_OPTIONS = [
  { value: "ROBOT", label: "Robot", emoji: "🤖", swatch: "from-slate-500 to-slate-700" },
  { value: "NINJA", label: "Ninja", emoji: "🥷", swatch: "from-zinc-600 to-zinc-900" },
  { value: "ASTRONAUT", label: "Astronauta", emoji: "🧑‍🚀", swatch: "from-indigo-500 to-violet-700" },
  { value: "PHOENIX", label: "Phoenix", emoji: "🔥", swatch: "from-amber-400 to-rose-600" },
  { value: "SHARK", label: "Shark", emoji: "🦈", swatch: "from-cyan-500 to-blue-700" },
  { value: "UNICORN", label: "Unicorn", emoji: "🦄", swatch: "from-fuchsia-500 to-pink-600" },
  { value: "DRAGON", label: "Dragon", emoji: "🐉", swatch: "from-emerald-500 to-teal-700" },
  { value: "WIZARD", label: "Wizard", emoji: "🧙", swatch: "from-purple-500 to-indigo-700" },
  { value: "RACER", label: "Racer", emoji: "🏎️", swatch: "from-red-500 to-orange-600" },
  { value: "TIGER", label: "Tiger", emoji: "🐯", swatch: "from-amber-500 to-yellow-600" },
  { value: "PANDA", label: "Panda", emoji: "🐼", swatch: "from-gray-400 to-gray-700" },
  { value: "PIXEL", label: "Pixel", emoji: "👾", swatch: "from-violet-500 to-fuchsia-700" },
] as const;

export const DEFAULT_AVATAR_PRESET = "ROBOT";
export const AVATAR_PRESET_VALUES = AVATAR_PRESET_OPTIONS.map((option) => option.value) as [
  (typeof AVATAR_PRESET_OPTIONS)[number]["value"],
  ...(typeof AVATAR_PRESET_OPTIONS)[number]["value"][],
];

export function getAvatarPreset(preset: string | null | undefined) {
  if (!preset) {
    return AVATAR_PRESET_OPTIONS[0];
  }
  return (
    AVATAR_PRESET_OPTIONS.find((item) => item.value === preset) ??
    AVATAR_PRESET_OPTIONS[0]
  );
}
