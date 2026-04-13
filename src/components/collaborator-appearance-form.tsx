"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateCollaboratorAppearanceAction } from "@/actions/admin-actions";
import { AVATAR_PRESET_OPTIONS } from "@/lib/avatar-presets";
import { DASHBOARD_TONE_OPTIONS } from "@/lib/dashboard-tones";

type Props = {
  collaboratorId: string;
  dashboardTone: string;
  avatarPreset: string;
};

function AutoSaveHint() {
  const { pending } = useFormStatus();

  return (
    <p className="text-xs text-zinc-500">
      {pending ? "Guardando apariencia..." : "Se guarda automaticamente al seleccionar."}
    </p>
  );
}

export function CollaboratorAppearanceForm({
  collaboratorId,
  dashboardTone,
  avatarPreset,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [selectedTone, setSelectedTone] = useState(dashboardTone);
  const [selectedAvatar, setSelectedAvatar] = useState(avatarPreset);
  const tonePreview =
    DASHBOARD_TONE_OPTIONS.find((tone) => tone.value === selectedTone) ??
    DASHBOARD_TONE_OPTIONS[0];

  return (
    <form ref={formRef} action={updateCollaboratorAppearanceAction} className="grid gap-2 rounded-xl border border-zinc-200 p-2">
      <input type="hidden" name="collaboratorId" value={collaboratorId} />
      <AutoSaveHint />

      <div className="grid gap-2 md:grid-cols-[auto_170px_minmax(280px,1fr)] md:items-center">
        <label className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Tema de tarjeta</label>
        <select
          name="dashboardTone"
          value={selectedTone}
          onChange={(event) => {
            setSelectedTone(event.currentTarget.value);
            event.currentTarget.form?.requestSubmit();
          }}
          className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          {DASHBOARD_TONE_OPTIONS.map((tone) => (
            <option key={tone.value} value={tone.value}>
              {tone.label}
            </option>
          ))}
        </select>
        <span
          className={`h-12 w-full min-w-[140px] max-w-[360px] rounded-xl border border-zinc-200 bg-gradient-to-r md:justify-self-end ${tonePreview.swatch}`}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Avatar</p>
        <input ref={avatarInputRef} type="hidden" name="avatarPreset" value={selectedAvatar} />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {AVATAR_PRESET_OPTIONS.map((avatar) => {
            const active = selectedAvatar === avatar.value;
            return (
              <button
                key={avatar.value}
                type="button"
                onClick={() => {
                  setSelectedAvatar(avatar.value);
                  if (avatarInputRef.current) {
                    avatarInputRef.current.value = avatar.value;
                  }
                  formRef.current?.requestSubmit();
                }}
                className={`min-w-[110px] flex-shrink-0 rounded-xl border p-2 text-center transition ${
                  active ? "border-black bg-zinc-50" : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                <span className="block rounded-lg border border-zinc-300 bg-zinc-100 p-1.5">
                  <span className="flex h-20 items-center justify-center rounded-md bg-white">
                    <span className="text-4xl">{avatar.emoji}</span>
                  </span>
                </span>
                <div className="mt-1 flex items-center justify-center gap-1">
                  <span className={`inline-block h-2 w-2 rounded-full bg-gradient-to-r ${avatar.swatch}`} />
                  <p className="text-xs text-zinc-700">{avatar.label}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </form>
  );
}
