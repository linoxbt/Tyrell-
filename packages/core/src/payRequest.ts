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
  /**
   * Unix seconds after which the signer must not broadcast this request. Bounds how long a request can
   * sit in the signer's queue, so control can settle a timed-out request by reading the chain (B-3).
   */
  deadline: bigint;
}

const TAG = keccak256(toBytes("tyrell.signer.pay.v2"));
const TAG_AGENT = keccak256(toBytes("tyrell.signer.payForAgent.v2"));

/** How long a pay request stays valid, in seconds. */
export const PAY_REQUEST_TTL = 60n;

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
            { type: "uint64" },
          ],
          [TAG, BigInt(r.chainId), r.vault, r.payeeId, r.token, r.amount, r.decisionId, r.deadline],
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
            { type: "uint64" },
          ],
          [TAG_AGENT, BigInt(r.chainId), r.vault, r.agentId, r.payeeId, r.token, r.amount, r.decisionId, r.deadline],
        ),
      );
