import { keccak256, numberToHex, recoverTypedDataAddress, toBytes, type Address, type Hex } from "viem";
import type { LocalAccount } from "viem/accounts";

/**
 * Agents network helpers (phase A and B). Mirrors AgentRegistry and AgentNetwork: permission bits, the
 * deal payee id convention, and the EIP-712 AgentMessage an agent key signs for another agent.
 */

/** AgentRegistry permission bits. */
export const PERM = { PAY: 1, MEMORY: 2, MESSAGE: 4, DEAL: 8 } as const;
export type PermName = keyof typeof PERM;

export const permMask = (names: readonly PermName[]): number => names.reduce((m, n) => m | PERM[n], 0);
export const permNames = (mask: number): PermName[] => (Object.keys(PERM) as PermName[]).filter((n) => (mask & PERM[n]) === PERM[n]);

/** In AgentRegistry, agent N delegated as a deal counterparty is payee id bytes32(N). */
export const dealPayeeId = (agentId: bigint): Hex => numberToHex(agentId, { size: 32 });

/** Why the registry refuses an agent, for people. */
export const AGENT_CODES: Record<string, string> = {
  UNKNOWN_AGENT: "no such agent",
  AGENT_REVOKED: "the agent was revoked by its human",
  AGENT_BANNED: "the agent was banned by the network after upheld reports",
  HUMAN_UNBOUND: "the human's QIE ID no longer resolves to them (moved or expired)",
  HUMAN_FROZEN: "the human froze all of their agents",
  NOT_PERMITTED: "the agent does not have that permission",
  PAYEE_NOT_DELEGATED: "that payee was not delegated to this agent",
  OVER_AGENT_TX_LIMIT: "over the agent's per-payment limit (or zero)",
  OVER_AGENT_DAILY_LIMIT: "over the agent's daily limit",
  OVER_HUMAN_QUOTA: "over the human's daily quota shared by all their agents",
  EXPIRED: "the message deadline passed",
  RECIPIENT_INACTIVE: "the receiving agent is not active",
  NOT_BONDED: "the sending agent has no bond (below the minimum)",
  BAD_SIGNATURE: "not signed by the sending agent's registered key",
};

/** Decode a bytes32 code returned by the registry or network. */
export const codeText = (code: Hex): string => {
  const bytes = toBytes(code);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.slice(0, end));
};

export interface AgentMessage {
  fromAgent: bigint;
  toAgent: bigint;
  bodyHash: Hex;
  nonce: bigint;
  deadline: bigint;
}

export const AGENT_MESSAGE_TYPES = {
  AgentMessage: [
    { name: "fromAgent", type: "uint256" },
    { name: "toAgent", type: "uint256" },
    { name: "bodyHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const agentNetworkDomain = (chainId: number, network: Address) => ({ name: "TyrellAgentNetwork", version: "1", chainId, verifyingContract: network }) as const;

export const messageBodyHash = (body: string): Hex => keccak256(toBytes(body));

/** The sending agent's key signs a message for another agent. Verify on-chain with AgentNetwork.verifyMessage. */
export function signAgentMessage(key: LocalAccount, chainId: number, network: Address, m: AgentMessage): Promise<Hex> {
  return key.signTypedData({ domain: agentNetworkDomain(chainId, network), types: AGENT_MESSAGE_TYPES, primaryType: "AgentMessage", message: m });
}

/** Who signed an agent message (compare with AgentRegistry.agent(fromAgent).key). */
export function agentMessageSigner(chainId: number, network: Address, m: AgentMessage, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain: agentNetworkDomain(chainId, network), types: AGENT_MESSAGE_TYPES, primaryType: "AgentMessage", message: m, signature });
}
