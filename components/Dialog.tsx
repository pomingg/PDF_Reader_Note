"use client";

import { useEffect, useRef } from "react";

export function Dialog({
  title,
  onClose,
  onSubmit,
  submitLabel = "確定",
  danger,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLInputElement>("input, select, textarea")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <form
        ref={ref}
        role="dialog"
        aria-label={title}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          await onSubmit?.();
        }}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <div className="space-y-3">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          {onSubmit && (
            <button type="submit" className={danger ? "btn btn-danger" : "btn btn-primary"}>
              {submitLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}
