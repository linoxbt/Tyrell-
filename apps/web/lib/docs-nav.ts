/** Docs navigation: top tabs, sidebar groups, page order (prev/next follow this order). */
export interface NavPage {
  slug: string;
  label: string;
  tab?: string;
}
export interface NavTab {
  id: string;
  label: string;
  groups: Array<{ title: string; pages: NavPage[] }>;
}

export const NAV: NavTab[] = [
  {
    id: "get-started",
    label: "Get started",
    groups: [
      {
        title: "Overview",
        pages: [
          { slug: "get-started/introduction", label: "Introduction" },
          { slug: "get-started/quickstart", label: "Quickstart" },
          { slug: "get-started/how-it-works", label: "How it works" },
          { slug: "get-started/architecture", label: "Architecture" },
        ],
      },
      { title: "Try it", pages: [{ slug: "guides/playground", label: "Playground" }] },
      { title: "Help", pages: [{ slug: "faq", label: "FAQ" }] },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    groups: [
      {
        title: "Run Tyrell",
        pages: [
          { slug: "guides/deploy-on-qie", label: "Deploy on QIE" },
          { slug: "guides/payees", label: "Payees" },
          { slug: "guides/steward-agent", label: "The Steward agent" },
          { slug: "guides/ai-sentinel", label: "AI sentinel" },
        ],
      },
      {
        title: "Operate",
        pages: [
          { slug: "guides/quarantine-and-blast-radius", label: "Quarantine and blast radius" },
          { slug: "guides/rebuild-and-verify", label: "Rebuild and verify" },
          { slug: "guides/web-console-and-wallet", label: "Web console and wallet" },
          { slug: "guides/attack-set", label: "Attack set" },
          { slug: "guides/mcp-server", label: "MCP server for other agents" },
        ],
      },
    ],
  },
  {
    id: "agents",
    label: "Agents network",
    groups: [
      {
        title: "Concepts",
        pages: [
          { slug: "agents/overview", label: "Overview" },
          { slug: "agents/qie-id-binding", label: "QIE ID binding" },
        ],
      },
      {
        title: "Phase A: one human, many agents",
        pages: [{ slug: "agents/agents-and-limits", label: "Agents, permissions and quota" }],
      },
      {
        title: "Phase B: the network",
        pages: [
          { slug: "agents/bonds-and-reports", label: "Bonds, reports and penalties" },
          { slug: "agents/reputation", label: "Reputation" },
          { slug: "agents/agent-to-agent", label: "Agent-to-agent" },
        ],
      },
      { title: "Operate", pages: [{ slug: "agents/deploy-and-cli", label: "Deploy and CLI" }] },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    groups: [
      {
        title: "Tools",
        pages: [
          { slug: "reference/cli", label: "CLI" },
          { slug: "reference/configuration", label: "Configuration" },
          { slug: "reference/networks", label: "Networks" },
        ],
      },
      {
        title: "Contracts",
        pages: [
          { slug: "reference/contracts-core", label: "Core contracts" },
          { slug: "reference/contracts-agents", label: "Agents network contracts" },
        ],
      },
      {
        title: "Formats and rules",
        pages: [
          { slug: "reference/policy-rules", label: "Policy rules" },
          { slug: "reference/errors", label: "Errors and codes" },
          { slug: "reference/envelope-format", label: "Envelope format" },
          { slug: "reference/view-document", label: "View document" },
        ],
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    groups: [
      {
        title: "Security",
        pages: [
          { slug: "security/threat-model", label: "Threat model" },
          { slug: "security/invariants", label: "Invariants" },
          { slug: "security/limitations", label: "Known limitations" },
        ],
      },
    ],
  },
];

export const tabOf = (slug: string) => NAV.find((t) => t.groups.some((g) => g.pages.some((p) => p.slug === slug)));
export const ORDER = NAV.flatMap((t) => t.groups.flatMap((g) => g.pages));
