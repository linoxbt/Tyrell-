import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import type { Id16 } from "./ids.js";

/** The exact GuardedVault.pay call control asks the signer to send. */
export interface PayRequest {
  chainId: number;
  vault: Address;
  payeeId: Hex;
  token: Address;
  amount: bigint;
  decisionId: Id16;
  /** Agents network: the proposing agent. Present means GuardedVault.payForAgent, absent means pay. */
  agentId?: bigint;
}

const TAG = keccak256(toBytes("tyrell.signer.pay.v1"));
const TAG_AGENT = keccak256(toBytes("tyrell.signer.payForAgent.v1"));

/**
 * Digest control signs (EIP-191, with the control lane key) to ask the signer for one payment. The
 * signer accepts a request only if it recovers to the active control key, so nothing but control can
 * make it sign (spec section 4, "Signer: must never accept requests from anything but control").
 */
export const payRequestDigest = (r: PayRequest): Hex =>
  r.agentId === undefined
    ? keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "address" },
            { type: "bytes32" },
            { type: "address" },
            { type: "uint256" },
            { type: "bytes16" },
          ],
          [TAG, BigInt(r.chainId), r.vault, r.payeeId, r.token, r.amount, r.decisionId],
        ),
      )
    : keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "address" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "address" },
            { type: "uint256" },
            { type: "bytes16" },
          ],
          [TAG_AGENT, BigInt(r.chainId), r.vault, r.agentId, r.payeeId, r.token, r.amount, r.decisionId],
        ),
      );
