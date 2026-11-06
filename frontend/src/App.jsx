import Nav from "./components/Nav";
import Footer from "./components/Footer";
import { useRoute } from "./lib/hooks";
import Home from "./pages/Home";
import Run from "./pages/Run";
import Seal from "./pages/Seal";
import EvalPage from "./pages/Eval";
import BenchmarkPage from "./pages/Benchmark";
import Trust from "./pages/Trust";
import NotFound from "./pages/NotFound";

export default function App() {
  const route = useRoute();
  const [a, b] = route.parts;
  let page;
  if (!a) page = <Home />;
  else if (a === "run") page = <Run preselect={route.query.get("benchmark")} />;
  else if (a === "seal") page = <Seal existingId={route.query.get("id")} />;
  else if (a === "eval" && b) page = <EvalPage id={b} />;
  else if (a === "benchmark" && b) page = <BenchmarkPage id={b} />;
  else if (a === "trust") page = <Trust />;
  else page = <NotFound />;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav path={route.path} />
      <main id="main" className="flex-1">
        {page}
      </main>
      <Footer />
    </div>
  );
}
