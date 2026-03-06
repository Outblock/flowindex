import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, type UIMessage } from "ai";

const CADENCE_MCP_BASE =
  process.env.CADENCE_MCP_BASE_URL || "https://cadence-mcp.up.railway.app";

// Pre-fetch security scan + type check via REST (no MCP, no Claude tool calls)
async function prefetchScan(
  code: string,
  network: string,
): Promise<{ scan: string; diagnostics: string }> {
  try {
    const res = await fetch(`${CADENCE_MCP_BASE}/api/security-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, network }),
    });
    if (!res.ok) {
      console.error(`[runner-audit] security-scan HTTP ${res.status}`);
      return { scan: "Security scan unavailable", diagnostics: "Type check unavailable" };
    }
    const data = await res.json();
    // Format scan findings for prompt
    const scanFindings = data.scan?.findings ?? [];
    const scanSummary = data.scan?.summary ?? {};
    const scanText = scanFindings.length > 0
      ? `Found ${scanFindings.length} issue(s): ${scanSummary.high ?? 0} high, ${scanSummary.medium ?? 0} medium, ${scanSummary.low ?? 0} low, ${scanSummary.info ?? 0} info\n\n${scanFindings
          .map((f: any) => `- [${(f.severity || "info").toUpperCase()}] Line ${f.line}: (${f.rule || "unknown"}) ${f.message}`)
          .join("\n")}`
      : "No security issues found.";
    const diagText = data.diagnostics || "No type errors found.";
    return { scan: scanText, diagnostics: diagText };
  } catch (e) {
    console.error("[runner-audit] prefetch failed:", e);
    return { scan: "Security scan unavailable", diagnostics: "Type check unavailable" };
  }
}

const AUDIT_SYSTEM_PROMPT = `You are a Cadence smart contract security auditor for deployed contracts on the Flow blockchain.

## Your Task

Analyze the contract code and the pre-fetched tool results below, then output a structured JSON audit.
The security scan and type check have ALREADY been run — their results are included below. Do NOT call any tools. Just analyze and output.

## Output Format

Output ONLY this JSON block. No extra text before or after.

\`\`\`json
{
  "findings": [
    {
      "severity": "high|medium|low|info",
      "line": 42,
      "column": 10,
      "rule": "rule-id",
      "message": "Clear description of the issue",
      "suggestion": "How to fix this issue",
      "source": "security|typecheck|best-practice|ai-review"
    }
  ],
  "summary": "Brief overall assessment of the contract's security posture",
  "score": "A|B|C|D|F"
}
\`\`\`

## Severity Guidelines

- **high**: Exploitable vulnerabilities, resource loss, unauthorized access, capability leaks
- **medium**: Access control issues, missing checks, unsafe patterns (force-unwrap, etc.)
- **low**: Code quality issues, non-standard patterns
- **info**: Style suggestions, naming conventions

## Important Notes

- Every finding MUST have a line number.
- Include findings from the automated scan AND your own manual review.
- Deduplicate — if the scan and your review find the same issue, report it once.
- If the contract looks clean, say so honestly. Don't invent issues.
- Output ONLY the JSON block. No prose, no explanation.`;

export async function POST(req: Request) {
  const {
    messages,
    code,
    contractName,
    network,
  }: {
    messages: UIMessage[];
    code?: string;
    contractName?: string;
    network?: string;
  } = await req.json();

  const net = network || "mainnet";

  // Pre-fetch scan results via REST (milliseconds, not seconds)
  const { scan, diagnostics } = await prefetchScan(code || "", net);

  const systemWithContext = `${AUDIT_SYSTEM_PROMPT}

## Contract to Audit

Contract: ${contractName || "Unknown"}
Network: ${net}

\`\`\`cadence
${code || "// No code provided"}
\`\`\`

## Security Scan Results (pre-fetched)

${scan}

## Type Check Results (pre-fetched)

${diagnostics}`;

  const result = streamText({
    model: anthropic("claude-opus-4-6"),
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 16000 },
      },
    },
    system: systemWithContext,
    messages: await convertToModelMessages(messages),
    // No tools — scan results are pre-fetched, Claude just analyzes
  });

  return result.toUIMessageStreamResponse();
}
