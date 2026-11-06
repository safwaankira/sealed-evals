export default function Footer() {
  return (
    <footer className="mx-auto mt-24 w-full max-w-6xl border-t border-line px-4 py-12">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" width="20" height="20" className="rounded" />
          <span className="title-4 whitespace-nowrap">Sealed Evals</span>
          <span className="caption-5 text-muted">Built for the NEAR Hackathon on Shade Agents and NEAR AI Cloud</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-4 body-6 text-muted">
          <a className="hover:text-ink" href="#/trust">How trust works</a>
          <a className="hover:text-ink" href="#/trust?s=privacy">Privacy</a>
          <a className="hover:text-ink" href="#/trust?s=limits">Limits</a>
          <a className="hover:text-ink" href="https://docs.near.org/ai/shade-agents/getting-started/introduction" target="_blank" rel="noreferrer">Shade Agents</a>
          <a className="hover:text-ink" href="https://docs.near.ai" target="_blank" rel="noreferrer">NEAR AI Cloud</a>
        </nav>
      </div>
    </footer>
  );
}
