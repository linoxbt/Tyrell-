import type { Metadata } from "next";
import { Nav } from "@/components/argus/Nav";
import { Footer } from "@/components/argus/Sections";
import { Playground } from "@/components/playground/Playground";

export const metadata: Metadata = {
  title: "Playground · Tyrell",
  description: "Can a hacker trick an AI into sending them your money? Run the same attack on an AI agent with an ordinary wallet and one protected by Tyrell. No wallet, no sign-up.",
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
