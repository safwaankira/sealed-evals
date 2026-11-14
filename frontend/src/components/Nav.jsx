import { useEffect, useState } from "react";
import { List, X, Wallet, SignOut } from "@phosphor-icons/react";
import { useWallet } from "../lib/hooks";
import { connectWallet, disconnectWallet, initWallet } from "../lib/near";
import { short } from "../lib/format";

const LINKS = [
  // a result page belongs to the leaderboard it ranks on, so "Run an eval" always reads as a fresh form
  { href: "#/", label: "Leaderboard", match: (p) => p === "/" || p.startsWith("/benchmark") || p.startsWith("/eval") },
  { href: "#/run", label: "Run an eval", match: (p) => p.startsWith("/run") },
  { href: "#/seal", label: "Seal a benchmark", match: (p) => p.startsWith("/seal") },
  { href: "#/trust", label: "Trust", match: (p) => p.startsWith("/trust") },
];

export default function Nav({ path }) {
  const { accountId } = useWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    initWallet().catch(() => {});
  }, []);
  useEffect(() => setOpen(false), [path]);

  const wallet = accountId ? (
    <button
      onClick={() => disconnectWallet()}
      className="group inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 button-sm text-ink transition duration-300 ease-weighted hover:bg-hover active:scale-[0.98]"
      title="Disconnect"
    >
      <span className="font-mono">{short(accountId, 10, 6)}</span>
      <SignOut size={16} className="text-muted group-hover:text-ink" aria-hidden />
    </button>
  ) : (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await connectWallet();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 button-sm text-void transition duration-300 ease-weighted hover:bg-[#e6e6e6] active:scale-[0.98] disabled:opacity-50"
    >
      <Wallet size={16} weight="bold" aria-hidden />
      Connect wallet
    </button>
  );

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-void">
        Skip to content
      </a>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 top-4 z-40 mx-auto flex w-fit max-w-[calc(100%-32px)] items-center gap-2 rounded-2xl border border-line bg-surface/70 p-2 backdrop-blur-xl"
      >
        <a href="#/" className="flex items-center gap-2 rounded-lg px-2 py-1 title-4 text-ink">
          <img src="/favicon.svg" alt="" width="24" height="24" className="rounded-md" />
          Sealed Evals
        </a>
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = l.match(path);
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 body-5 transition duration-300 ease-weighted ${active ? "bg-hover text-ink" : "text-muted hover:text-ink"}`}
              >
                {l.label}
              </a>
            );
          })}
        </div>
        <div className="hidden md:block">{wallet}</div>
        <button
          className="relative grid h-10 w-10 place-items-center rounded-lg text-ink hover:bg-hover md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <List size={20} className={`absolute transition duration-500 ease-weighted ${open ? "rotate-90 opacity-0" : "opacity-100"}`} aria-hidden />
          <X size={20} className={`absolute transition duration-500 ease-weighted ${open ? "opacity-100" : "-rotate-90 opacity-0"}`} aria-hidden />
        </button>
      </nav>

      <div
        className={`fixed inset-0 z-30 flex flex-col gap-2 bg-void/95 px-4 pt-24 backdrop-blur-2xl transition duration-500 ease-weighted md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!open}
      >
        {LINKS.map((l, i) => (
          <a
            key={l.href}
            href={l.href}
            tabIndex={open ? 0 : -1}
            style={{ transitionDelay: open ? `${Math.min(i * 60, 400)}ms` : "0ms" }}
            className={`rounded-xl px-4 py-3 heading-6 transition duration-500 ease-weighted ${open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${l.match(path) ? "bg-surface text-ink" : "text-muted"}`}
          >
            {l.label}
          </a>
        ))}
        <div className="mt-4 px-4">{wallet}</div>
      </div>
    </>
  );
}
