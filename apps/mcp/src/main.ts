#!/usr/bin/env node
import { runStdio } from "./index.js";

runStdio().catch((e: Error) => {
  process.stderr.write(`tyrell mcp: ${e.message}\n`);
  process.exit(1);
});
