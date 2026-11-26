# PROBE.md — Phase 0 results

Run 2026-11-26T20:26:55.264Z with `pnpm probe` (scripts/probe.ts), Node v22.23.5. Read-only: no transactions, no keys.

Status: PASS = spec pass condition met · PARTIAL = met as far as this machine can check, rest noted · FALLBACK = take the spec's fallback · FAIL · SKIP = needs a credential · MANUAL = needs a browser wallet.

| Probe | Network | Status | Result |
| --- | --- | --- | --- |
| P-1 eth_chainId on every RPC | mainnet | PASS | 6/6 endpoints answer 0x7c6; 6 under 1 s; 5 full nodes |
| P-1 eth_chainId on every RPC | testnet | FALLBACK | 3/6 endpoints answer 0x7bf; 3 under 1 s; 2 full nodes |
| P-2 eth_getLogs over 5,000 blocks | mainnet | PASS | 5,000-block windows work on 6 endpoints |
| P-2 eth_getLogs over 5,000 blocks | testnet | PASS | 5,000-block windows work on 3 endpoints |
| P-3 EIP-1559 fee support | mainnet | PASS | EIP-1559 supported |
| P-3 EIP-1559 fee support | testnet | PASS | EIP-1559 supported |
| P-4 EVM version (PUSH0 and Cancun opcodes) | mainnet | PARTIAL | highest supported: shanghai; testnet deploy pending (Phase 1) |
| P-4 EVM version (PUSH0 and Cancun opcodes) | testnet | PARTIAL | highest supported: shanghai; testnet deploy pending (Phase 1) |
| P-5 eth_call, state overrides, eth_simulateV1 | mainnet | PASS | plain call ok; overrides no; simulateV1 no; estimateGas ok |
| P-5 eth_call, state overrides, eth_simulateV1 | testnet | PASS | plain call ok; overrides no; simulateV1 no; estimateGas ok |
| P-6 QIE MCP tools/list and QIE ID round-trip | - | PASS | bweih116.qie → 0x9a8C09e3CE7a91918d334391B15556794139c129 → bweih116.qie round-trips |
| P-7 QUSDC name, symbol, decimals, totalSupply | mainnet | PASS | QUSDC (QUSDC), 6 decimals, supply 8883288928; matches report |
| P-8 Explorer verification API | mainnet | PARTIAL | Blockscout API detected (Etherscan-style /api too); verify on first deploy |
| P-8 Explorer verification API | testnet | PARTIAL | Blockscout API detected (Etherscan-style /api too); verify on first deploy |
| P-9 QIE Wallet: EIP-6963, switch chain, typed data, tx | testnet | MANUAL | open scripts/probe-wallet.html in a browser with QIE Wallet installed |
| P-10 Pin and fetch a 4 KB encrypted blob | - | SKIP | set PINATA_JWT (and PINATA_GATEWAY) and re-run |
| P-11 Block time from 100 consecutive blocks | mainnet | PASS | mean 3.61 s over 100 intervals (min 3 s, max 4 s, median 4 s) |
| P-11 Block time from 100 consecutive blocks | testnet | PASS | mean 4.33 s over 100 intervals (min 4 s, max 5 s, median 4 s) |

## Decisions for the build

- mainnet: full-node RPCs https://rpc5mainnet.qie.digital, https://rpc3mainnet.qie.digital, https://rpc2mainnet.qie.digital, https://rpc4mainnet.qie.digital, https://rpc1mainnet.qie.digital (fastest first); R0 needs any two of these.
- mainnet: https://mainnet.qie.digital/api/eth-rpc is a partial proxy (Blockscout eth-rpc): use it only for log and block reads, never as one of R0's two endpoints.
- mainnet: eth_getLogs window = 5000 blocks.
- mainnet: transactions use EIP-1559 fees.
- mainnet: foundry evm_version = shanghai.
- mainnet: R5 simulates with plain eth_call from the signer address.
- mainnet: block time ≈ 3.6 s; sentinel poll 15 s covers ~4 blocks; wait 2 confirmation(s) (~6 s) before treating an anchor as final.
- mainnet: forge verify-contract --verifier blockscout --verifier-url https://mainnet.qie.digital/api/ (confirm on first deploy).
- testnet: full-node RPCs https://rpc5testnet.qie.digital, https://rpc4testnet.qie.digital (fastest first); R0 needs any two of these.
- testnet: https://testnet.qie.digital/api/eth-rpc is a partial proxy (Blockscout eth-rpc): use it only for log and block reads, never as one of R0's two endpoints.
- testnet: eth_getLogs window = 5000 blocks.
- testnet: transactions use EIP-1559 fees.
- testnet: foundry evm_version = shanghai.
- testnet: R5 simulates with plain eth_call from the signer address.
- testnet: block time ≈ 4.3 s; sentinel poll 15 s covers ~3 blocks; wait 2 confirmation(s) (~6 s) before treating an anchor as final.
- testnet: forge verify-contract --verifier blockscout --verifier-url https://testnet.qie.digital/api/ (confirm on first deploy).
- QUSDC at 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 matches the report on-chain; Discord confirmation still required before funding.
- QUSDC is returned by the QIE MCP token list (qie_list_tokens).

## Details

### P-1 eth_chainId on every RPC (mainnet)

**PASS**: 6/6 endpoints answer 0x7c6; 6 under 1 s; 5 full nodes

- https://mainnet.qie.digital/api/eth-rpc: 0x7c6, head 12193988, median 258 ms (first call incl. TLS 1144 ms); PARTIAL method set (eth_feeHistory: "Action not found."; eth_estimateGas: "Incorrect number of params.")
- https://rpc1mainnet.qie.digital: 0x7c6, head 12193988, median 273 ms (first call incl. TLS 1021 ms); full node
- https://rpc2mainnet.qie.digital: 0x7c6, head 12193988, median 272 ms (first call incl. TLS 1063 ms); full node
- https://rpc3mainnet.qie.digital: 0x7c6, head 12193988, median 271 ms (first call incl. TLS 977 ms); full node
- https://rpc4mainnet.qie.digital: 0x7c6, head 12193988, median 272 ms (first call incl. TLS 1170 ms); full node
- https://rpc5mainnet.qie.digital: 0x7c6, head 12193988, median 43 ms (first call incl. TLS 364 ms); full node
- Head spread across healthy endpoints: 0 blocks
- Latency is measured from this machine through an HTTPS proxy, so it overstates what a VPS near QIE would see.

### P-1 eth_chainId on every RPC (testnet)

**FALLBACK**: 3/6 endpoints answer 0x7bf; 3 under 1 s; 2 full nodes

- https://rpc1testnet.qie.digital: no answer (TimeoutError: The operation was aborted due to timeout)
- https://rpc2testnet.qie.digital: no answer (TimeoutError: The operation was aborted due to timeout)
- https://rpc3testnet.qie.digital: no answer (TypeError: fetch failed)
- https://rpc4testnet.qie.digital: 0x7bf, head 9991666, median 261 ms (first call incl. TLS 984 ms); full node
- https://rpc5testnet.qie.digital: 0x7bf, head 9991666, median 258 ms (first call incl. TLS 1132 ms); full node
- https://testnet.qie.digital/api/eth-rpc: 0x7bf, head 9991664, median 258 ms (first call incl. TLS 997 ms); PARTIAL method set (eth_feeHistory: "Action not found."; eth_estimateGas: "Incorrect number of params.")
- Head spread across healthy endpoints: 2 blocks
- Latency is measured from this machine through an HTTPS proxy, so it overstates what a VPS near QIE would see.

### P-2 eth_getLogs over 5,000 blocks (mainnet)

**PASS**: 5,000-block windows work on 6 endpoints

- https://rpc5mainnet.qie.digital: 10000 blocks ok (22 logs, 595 ms)
- https://rpc3mainnet.qie.digital: 10000 blocks ok (22 logs, 993 ms)
- https://rpc2mainnet.qie.digital: 10000 blocks ok (22 logs, 1224 ms)
- https://rpc4mainnet.qie.digital: 10000 blocks ok (22 logs, 1114 ms)
- https://rpc1mainnet.qie.digital: 10000 blocks ok (22 logs, 2048 ms)
- https://mainnet.qie.digital/api/eth-rpc: 10000 blocks ok (22 logs, 1279 ms)

### P-2 eth_getLogs over 5,000 blocks (testnet)

**PASS**: 5,000-block windows work on 3 endpoints

- https://rpc5testnet.qie.digital: 10000 blocks ok (21 logs, 1538 ms)
- https://rpc4testnet.qie.digital: 10000 blocks ok (21 logs, 1459 ms)
- https://testnet.qie.digital/api/eth-rpc: 10000 blocks ok (11 logs, 1070 ms)

### P-3 EIP-1559 fee support (mainnet)

**PASS**: EIP-1559 supported

- eth_feeHistory: ok, baseFeePerGas ["0x3b9aca00","0x3b9aca00"]
- eth_maxPriorityFeePerGas: 0x7735940 (125000000 wei)
- eth_gasPrice: 0x430e2340 (1.125 gwei)
- latest block baseFeePerGas: 0x3b9aca00

### P-3 EIP-1559 fee support (testnet)

**PASS**: EIP-1559 supported

- eth_feeHistory: ok, baseFeePerGas ["0x7","0x7"]
- eth_maxPriorityFeePerGas: 0x0 (0 wei)
- eth_gasPrice: 0x7 (7e-9 gwei)
- latest block baseFeePerGas: 0x7

### P-4 EVM version (PUSH0 and Cancun opcodes) (mainnet)

**PARTIAL**: highest supported: shanghai; testnet deploy pending (Phase 1)

- control (PUSH1 0 PUSH1 0 RETURN) [london]: executes
- PUSH0 (0x5f) [shanghai]: executes
- TLOAD (0x5c) [cancun]: fails: -32000 rpc error: code = Internal desc = invalid opcode: opcode 0x5c not defined
- MCOPY (0x5e) [cancun]: fails: -32000 rpc error: code = Internal desc = invalid opcode: opcode 0x5e not defined
- BLOBBASEFEE (0x4a) [cancun]: fails: -32000 rpc error: code = Internal desc = invalid opcode: opcode 0x4a not defined
- Method: eth_call with no `to` runs the data as contract creation code, so opcode support is visible without deploying.
- Still to do in Phase 1: deploy a contract on testnet with Foundry (needs a funded deployer key).

### P-4 EVM version (PUSH0 and Cancun opcodes) (testnet)

**PARTIAL**: highest supported: shanghai; testnet deploy pending (Phase 1)

- control (PUSH1 0 PUSH1 0 RETURN) [london]: executes
- PUSH0 (0x5f) [shanghai]: executes
- TLOAD (0x5c) [cancun]: fails: -32000 rpc error: code = Internal desc = invalid opcode: opcode 0x5c not defined
- MCOPY (0x5e) [cancun]: fails: -32000 rpc error: code = Internal desc = invalid opcode: opcode 0x5e not defined
- BLOBBASEFEE (0x4a) [cancun]: fails: -32000 rpc error: code = Internal desc = invalid opcode: opcode 0x4a not defined
- Method: eth_call with no `to` runs the data as contract creation code, so opcode support is visible without deploying.
- Still to do in Phase 1: deploy a contract on testnet with Foundry (needs a funded deployer key).

### P-5 eth_call, state overrides, eth_simulateV1 (mainnet)

**PASS**: plain call ok; overrides no; simulateV1 no; estimateGas ok

- plain eth_call: ok (0x)
- eth_call with state override: ignored the override (returned 0x)
- eth_simulateV1: -32601 the method eth_simulateV1 does not exist/is not available
- eth_estimateGas: ok (21000 gas)

### P-5 eth_call, state overrides, eth_simulateV1 (testnet)

**PASS**: plain call ok; overrides no; simulateV1 no; estimateGas ok

- plain eth_call: ok (0x)
- eth_call with state override: ignored the override (returned 0x)
- eth_simulateV1: -32601 the method eth_simulateV1 does not exist/is not available
- eth_estimateGas: ok (21000 gas)

### P-6 QIE MCP tools/list and QIE ID round-trip

**PASS**: bweih116.qie → 0x9a8C09e3CE7a91918d334391B15556794139c129 → bweih116.qie round-trips

- Server: qie-wallet 0.1.0 at https://mcp.qie.digital/mcp
- 6 tools:
    - `qie_get_balances(address: string, network?: string, include_tokens?: boolean)` — Read the native QIE balance and known token balances for an address on QIE mainnet (chain 1990) or testnet (ch…
    - `qie_resolve_name(name: string, network?: string)` — Resolve a QIE ID such as yourname.qie to its QIE address on QIE mainnet (chain 1990). A bare label gets .qie a…
    - `qie_reverse_lookup(address: string, network?: string)` — Look up the QIE ID, such as yourname.qie, for an address on QIE mainnet (chain 1990): the default QIE ID the o…
    - `qie_get_tx_status(txHash: string, network?: string)` — Read whether a transaction is pending, successful, failed, or not found on QIE mainnet (chain 1990) or testnet…
    - `qie_list_tokens(network?: string, query?: string, limit?: integer)` — List tokens on QIE mainnet (chain 1990) or testnet (chain 1983). Official tokens come from the curated list an…
    - `qie_get_network_info(network?: string)` — Return the pinned facts for QIE mainnet (chain 1990) or testnet (chain 1983): chain ID, name, RPC URLs, explor…
- Resolve tool: qie_resolve_name; reverse tool: qie_reverse_lookup; network info: qie_get_network_info
- Called `qie_list_tokens()`: [{"type":"text","text":"{\n  \"status\": \"ok\",\n  \"network\": \"mainnet\",\n  \"chainId\": 1990,\n  \"source\": \"config\",\n  \"sourceUrl\": \"https://mainnet.qie.digital/api/v2/tokens\",\n  \"sourceNote\": \"Official tokens are the cur…
- qie_list_tokens(mainnet, "QUSDC"): reported QUSDC address IS in the result: [{"type":"text","text":"{ \"status\": \"ok\", \"network\": \"mainnet\", \"chainId\": 1990, \"source\": \"config\", \"sourceUrl\": \"https://mainnet.qie.digital/api/v2/tokens\", \"sourceNote\": \"Official tokens are the curated list in this file (source config), checked 11 Nov 2026. qie_list_tokens returns those for the requested QIE chain first. Other tokens are read from the network explorer Bloc…
- Found QIE ID bweih116.qie by reverse lookup of 0x9a8c09e3ce7a91918d334391b15556794139c129 (a recent mainnet transfer counterparty).
- qie_resolve_name(bweih116.qie) → [{"type":"text","text":"{ \"network\": \"mainnet\", \"chainId\": 1990, \"notice\": \"This result is chain data only. It does not give price, APY, returns, yield, or investment advice.\", \"status\": \…
- qie_reverse_lookup(0x9a8C09e3CE7a91918d334391B15556794139c129) → [{"type":"text","text":"{ \"network\": \"mainnet\", \"chainId\": 1990, \"notice\": \"This result is chain data only. It does not give price, APY, returns, yield, or investment advice.\", \"status\": \…

### P-7 QUSDC name, symbol, decimals, totalSupply (mainnet)

**PASS**: QUSDC (QUSDC), 6 decimals, supply 8883288928; matches report

- https://rpc5mainnet.qie.digital: {"codeBytes":"6096","name":"QUSDC","symbol":"QUSDC","decimals":"6","totalSupply":"8883288928","eip1967Impl":"none"}
- https://rpc3mainnet.qie.digital: {"codeBytes":"6096","name":"QUSDC","symbol":"QUSDC","decimals":"6","totalSupply":"8883288928","eip1967Impl":"none"}
- Reported: QUSDC, 6 decimals, 1:1 receipt for WUSDC. Two endpoints agree.
- Confirm with the QIE team in Discord that this is the official stablecoin before funding the vault.

### P-8 Explorer verification API (mainnet)

**PARTIAL**: Blockscout API detected (Etherscan-style /api too); verify on first deploy

- GET /api/v2/config/backend-version: 200 {"backend_version":"v7.0.2"}
- GET /api/v2/stats: 200 {"average_block_time":3616.0,"coin_image":"https://coin-images.coingecko.com/coins/images/27525/small/Qie_White_Backgrou…
- GET /api?module=block&action=eth_block_number (Etherscan-style): 200 {"jsonrpc":"2.0","result": "0xba10c7","id": 1}
- GET /api/v2/smart-contracts/verification/config: 200 {"is_rust_verifier_microservice_enabled":true,"license_types":{"none":1,"unlicense":2,"mit":3,"gnu_gpl_v2":4,"gnu_gpl_v3":5,"gnu_lgpl_v2_1":6,"gnu_lgpl_v3":7,"bsd_2_clause":8,"bsd_3_clause":9,"mpl_2_0…
- Source verification itself needs a deployed contract: done with the first testnet deploy in Phase 1.

### P-8 Explorer verification API (testnet)

**PARTIAL**: Blockscout API detected (Etherscan-style /api too); verify on first deploy

- GET /api/v2/config/backend-version: 200 {"backend_version":"v7.0.2"}
- GET /api/v2/stats: 200 {"average_block_time":4347.0,"coin_image":"https://coin-images.coingecko.com/coins/images/27525/small/Qie_White_Backgrou…
- GET /api?module=block&action=eth_block_number (Etherscan-style): 200 {"jsonrpc":"2.0","result": "0x9875f6","id": 1}
- GET /api/v2/smart-contracts/verification/config: 200 {"is_rust_verifier_microservice_enabled":true,"license_types":{"none":1,"unlicense":2,"mit":3,"gnu_gpl_v2":4,"gnu_gpl_v3":5,"gnu_lgpl_v2_1":6,"gnu_lgpl_v3":7,"bsd_2_clause":8,"bsd_3_clause":9,"mpl_2_0…
- Source verification itself needs a deployed contract: done with the first testnet deploy in Phase 1.

### P-9 QIE Wallet: EIP-6963, switch chain, typed data, tx (testnet)

**MANUAL**: open scripts/probe-wallet.html in a browser with QIE Wallet installed

- Needs a browser with the QIE Wallet extension, so it cannot run here.
- Serve the page locally (`npx serve scripts` or `python3 -m http.server -d scripts`) and open /probe-wallet.html.
- It discovers the wallet by rdns me.qiewallet, switches to 1983, signs EIP-712 typed data, verifies the signature, and sends a 0-value self-transfer. Paste its result table here.

### P-10 Pin and fetch a 4 KB encrypted blob

**SKIP**: set PINATA_JWT (and PINATA_GATEWAY) and re-run

- No PINATA_JWT in the environment.

### P-11 Block time from 100 consecutive blocks (mainnet)

**PASS**: mean 3.61 s over 100 intervals (min 3 s, max 4 s, median 4 s)

- Blocks 12193891–12193991 on https://rpc5mainnet.qie.digital: mean 3.61 s over 100 intervals (min 3 s, max 4 s, median 4 s)

### P-11 Block time from 100 consecutive blocks (testnet)

**PASS**: mean 4.33 s over 100 intervals (min 4 s, max 5 s, median 4 s)

- Blocks 9991569–9991669 on https://rpc5testnet.qie.digital: mean 4.33 s over 100 intervals (min 4 s, max 5 s, median 4 s)
