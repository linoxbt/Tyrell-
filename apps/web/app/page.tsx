"use client";

import { Hero } from "@/components/site/Hero";
import { Nav } from "@/components/site/Nav";
import { Problem } from "@/components/site/Problem";
import { AttackGate, BuiltOnQie, Cta, Faq, Footer, Guarantees, HowItWorks, Platform } from "@/components/site/Sections";
import { useView } from "@/lib/useView";

export default function Landing() {
  const { view } = useView(30_000);
  return (
    <>
      <Nav />
      <main>
        <Hero view={view} />
        <Problem view={view} />
        <HowItWorks />
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
