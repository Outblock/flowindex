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
import { systemPrompt } from "@/lib/system-prompt";

const MCP_URL = process.env.MCP_SERVER_URL || "http://localhost:8085/mcp";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const mcpClient = await createMCPClient({
    transport: { type: "http", url: MCP_URL },
  });

  const mcpTools = await mcpClient.tools();

  const result = streamText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools: {
      ...mcpTools,
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
      await mcpClient.close();
    },
  });

  return result.toUIMessageStreamResponse();
}
