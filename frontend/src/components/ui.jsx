import { forwardRef } from "react";
import { LockKey, Warning, CircleNotch, CheckCircle, XCircle, Clock } from "@phosphor-icons/react";
import { useReveal } from "../lib/hooks";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 transition duration-300 ease-weighted active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";

export function Button({ variant = "primary", size = "md", className = "", children, busy, ...props }) {
  const v =
    variant === "primary"
      ? "bg-ink text-void hover:bg-[#e6e6e6]"
      : variant === "ghost"
        ? "text-muted hover:text-ink hover:bg-hover"
        : "bg-raised text-ink hover:bg-hover border border-line";
  const t = size === "sm" ? "button-sm" : "button-md";
  return (
    <button className={`${base} ${v} ${t} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <CircleNotch size={16} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", className = "", children }) {
  const v =
    variant === "primary"
      ? "bg-ink text-void hover:bg-[#e6e6e6]"
      : "bg-raised text-ink hover:bg-hover border border-line";
  return (
    <a href={href} className={`${base} ${v} button-md ${className}`}>
      {children}
    </a>
  );
}

export function ModeBadge({ mode, size = "md" }) {
  const sealed = mode === "Sealed";
  const cls = sealed ? "bg-sealed-bg text-sealed border-sealed/30" : "bg-leak-bg text-leak border-leak/30";
  const pad = size === "sm" ? "px-2 py-0.5 caption-3" : "px-2 py-1 caption-3";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border ${cls} ${pad}`}>
      {sealed ? <LockKey size={12} weight="bold" aria-hidden /> : <Warning size={12} weight="bold" aria-hidden />}
      {sealed ? "Sealed" : "Leak risk"}
    </span>
  );
}

export function StatusBadge({ status }) {
  const map = {
    Pending: ["text-muted bg-raised border-line", Clock, "Running"],
    Completed: ["text-sealed bg-sealed-bg border-sealed/30", CheckCircle, "Scored"],
    Failed: ["text-bad bg-bad-bg border-bad/30", XCircle, "Failed, refunded"],
    Refunded: ["text-muted bg-raised border-line", XCircle, "Refunded"],
  };
  const [cls, Icon, label] = map[status] ?? map.Pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 caption-3 ${cls}`}>
      <Icon size={12} weight="bold" aria-hidden />
      {label}
    </span>
  );
}

export function Card({ className = "", children, ...p }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${className}`} {...p}>
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Mono({ children, className = "" }) {
  return <span className={`font-mono break-all ${className}`}>{children}</span>;
}

export function ErrorNote({ error, className = "" }) {
  if (!error) return null;
  return (
    <p role="alert" className={`rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 body-6 text-bad ${className}`}>
      {error.message || String(error)}
    </p>
  );
}

export const Reveal = forwardRef(function Reveal({ as: Tag = "section", className = "", children, ...p }, _ref) {
  const ref = useReveal();
  return (
    <Tag ref={ref} className={`reveal ${className}`} {...p}>
      {children}
    </Tag>
  );
});

export function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="title-4 text-ink">{label}</span>
      {children}
      {hint ? <span className="caption-5 text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-void px-3 py-2 body-6 text-ink placeholder:text-faint transition duration-300 ease-weighted hover:border-[#4a4a4a] focus:border-sealed focus:outline-none";

/**
 * One square per hidden question. Filled means that answer carries a signature from the attested
 * model TEE. Which answers were right is never shown: that would leak the key.
 */
export function SignatureGrid({ total, signed, tone = "sealed", className = "" }) {
  const ref = useReveal();
  const on = tone === "sealed" ? "bg-sealed" : "bg-leak";
  return (
    <div
      ref={ref}
      className={`sig-grid grid w-fit grid-cols-[repeat(13,12px)] gap-1 ${className}`}
      role="img"
      aria-label={`${signed} of ${total} answers signed by the attested model`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`sig-cell h-3 w-3 rounded-sm ${i < signed ? on : "bg-hover"}`}
          style={{ transitionDelay: `${Math.min(i * 12, 400)}ms` }}
        />
      ))}
    </div>
  );
}
