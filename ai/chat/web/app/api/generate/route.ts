import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    nodeType: z.string(),
    config: z.record(z.string(), z.string()),
  }),
});

const edgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
});

const workflowSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  name: z.string(),
});

export async function POST(req: Request) {
  const { messages }: { messages: Array<{ role: string; content: string }> } =
    await req.json();

  const systemMessage = messages.find((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role !== "system");

  const { object } = await generateObject({
    model: anthropic(process.env.LLM_MODEL || "claude-sonnet-4-6"),
    schema: workflowSchema,
    system: systemMessage?.content,
    messages: userMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    providerOptions: {
      anthropic: {
        structuredOutputMode: "auto",
      },
    },
  });

  return Response.json(object);
}
