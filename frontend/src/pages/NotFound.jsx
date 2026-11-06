import { LinkButton } from "../components/ui";

export default function NotFound() {
  return (
    <section className="mx-auto mt-12 flex max-w-3xl flex-col items-start gap-4 px-4 pt-24">
      <span className="font-mono caption-3 text-muted">404</span>
      <h1 className="heading-4">This page is sealed so well even we can't find it</h1>
      <p className="body-6 text-muted">The link may be old, or the eval id may not exist on this contract.</p>
      <LinkButton href="#/">Back to the leaderboard</LinkButton>
    </section>
  );
}
