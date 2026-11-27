import type { Metadata } from "next";
import { Nav } from "@/components/argus/Nav";
import { Footer } from "@/components/argus/Sections";
import { Playground } from "@/components/playground/Playground";

export const metadata: Metadata = {
  title: "Playground · Tyrell",
  description: "Tyrell's real contracts running live in your browser: 34 checks from forged memories to banned agents. No wallet, no login.",
};

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Playground />
      </main>
      <Footer />
    </>
  );
}
