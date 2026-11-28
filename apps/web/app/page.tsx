"use client";

import { Hero } from "@/components/argus/Hero";
import { Nav } from "@/components/argus/Nav";
import { Problem } from "@/components/argus/Problem";
import { AttackGate, BuiltOnQie, Cta, Faq, Footer, Guarantees, Marquee, Platform, Steps } from "@/components/argus/Sections";
import { useReveal } from "@/lib/useReveal";
import { useSample } from "@/lib/useView";

// Section order follows the Argus template: hero + dashboard, logo strip, problem, steps, platform, eval gate,
// integrations, pricing (here: guarantees), FAQ, CTA, footer.
export default function Landing() {
  const { view } = useSample();
  useReveal([Boolean(view)]);
  return (
    <>
      <Nav />
      <main>
        <Hero view={view} />
        <Marquee view={view} />
        <Problem view={view} />
        <Steps />
        <Platform view={view} />
        <AttackGate />
        <BuiltOnQie view={view} />
        <Guarantees />
        <Faq />
        <Cta />
      </main>
      <Footer view={view} />
    </>
  );
}
