import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

export async function POST(req: Request) {
  const { messages }: { messages: Array<{ role: string; content: string }> } =
    await req.json();

  const systemMessage = messages.find((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role !== "system");

  const result = streamText({
    model: anthropic(process.env.LLM_MODEL || "claude-sonnet-4-6"),
    system: systemMessage?.content,
    messages: userMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  return result.toTextStreamResponse();
}
