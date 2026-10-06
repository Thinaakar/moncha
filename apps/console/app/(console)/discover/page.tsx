import { DiscoverPanel } from './discover-panel';

export default function Discover() {
  return (
    <main>
      <section className="hero-panel">
        <h1>Discover</h1>
        <p>
          Discovery source → Neon. New companies become leads in Pending audit. Re-running the same
          country dedupes by domain (counts as already saved, not failed).
        </p>
      </section>
      <DiscoverPanel />
    </main>
  );
}
