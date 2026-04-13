"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  idleLabel: string;
  pendingLabel?: string;
};

export function SubmitButton({
  idleLabel,
  pendingLabel,
  disabled = false,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={disabled || pending} {...props}>
      {pending ? pendingLabel ?? "Guardando..." : idleLabel}
    </button>
  );
}
