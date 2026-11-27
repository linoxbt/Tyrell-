import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/DocsShell";

export const metadata: Metadata = {
  title: { default: "Tyrell Docs", template: "%s · Tyrell Docs" },
  description: "Documentation for Tyrell: memory provenance, quarantine and guarded payments for AI agents on QIE, and the agents network.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
