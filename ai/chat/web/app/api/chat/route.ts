import { createMCPClient } from "@ai-sdk/mcp";
import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getSystemPrompt } from "@/lib/system-prompt";

const MCP_URL = process.env.MCP_SERVER_URL || "http://localhost:8085/mcp";
const CADENCE_MCP_URL =
  process.env.CADENCE_MCP_URL || "https://cadence-mcp.up.railway.app/mcp";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const [mcpClient, cadenceMcp] = await Promise.all([
    createMCPClient({ transport: { type: "http", url: MCP_URL } }),
    createMCPClient({ transport: { type: "http", url: CADENCE_MCP_URL } }),
  ]);

  const [mcpTools, cadenceTools] = await Promise.all([
    mcpClient.tools(),
    cadenceMcp.tools(),
  ]);

  const result = streamText({
    model: anthropic(process.env.LLM_MODEL || "claude-sonnet-4-6"),
    system: getSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools: {
      ...mcpTools,
      ...cadenceTools,
      createChart: tool({
        description:
          "Create a chart visualization from data. Use this after running a SQL query to visualize the results. Supports bar, line, pie, doughnut, and horizontal bar charts.",
        inputSchema: z.object({
          chartType: z
            .enum(["bar", "line", "pie", "doughnut", "horizontalBar"])
            .describe("The type of chart to render"),
          title: z.string().describe("Chart title"),
          labels: z
            .array(z.string())
            .describe("Labels for the x-axis or pie slices"),
          datasets: z
            .array(
              z.object({
                label: z.string().describe("Dataset label"),
                data: z.array(z.number()).describe("Data values"),
              })
            )
            .describe("One or more datasets to plot"),
        }),
        execute: async ({ chartType, title, labels, datasets }) => {
          return { chartType, title, labels, datasets };
        },
      }),
    },
    stopWhen: stepCountIs(5),
    onFinish: async () => {
      await Promise.all([mcpClient.close(), cadenceMcp.close()]);
    },
  });

  return result.toUIMessageStreamResponse();
}
