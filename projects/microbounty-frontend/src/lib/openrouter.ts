const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.warn("Missing VITE_OPENROUTER_API_KEY in environment variables.");
}

const COMMON_HEADERS = {
  "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://microbounty.app",
  "X-Title": "MicroBounty"
};

// Judge model: the same one the qa-agent Edge Function uses
export const JUDGE_MODEL = "openai/gpt-4o-mini";

/**
 * Generic OpenRouter caller
 */
export async function callOpenRouter(model: string, prompt: string, isJson: boolean = false) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }],
      ...(isJson ? { response_format: { type: "json_object" } } : {})
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter failed: ${response.status} ${JSON.stringify(errorData)}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 1. MATCHMAKER AI (gpt-4o-mini)
 * Suggests top 3 matching agents based on client input.
 */
export async function callMatchmaker(clientInput: string, availableAgents: any[]) {
  const prompt = `You are an AI agent matchmaker. Given the client's task description and list of available agents, return the top 3 matching agents as JSON.
Task: ${clientInput}
Available agents: ${JSON.stringify(availableAgents)}
Return strictly in this JSON format:
{ "matches": [ { "agent_id": "string", "match_score": number, "reason": "string" } ] }`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error("Matchmaker failed");
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

/**
 * 2. ENHANCER AI (llama-3.1-8b-instruct)
 * Improves agent description.
 */
export async function callEnhancer(description: string) {
  const prompt = `Improve this AI agent description to be more professional and compelling for potential clients. Keep it concise.
Original: ${description}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error("Enhancer failed");
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 3. LEGAL/CODE WORKER AI (claude-3.5-sonnet)
 * Used as a fallback or for specific complex tasks.
 */
export async function callWorkerAI(prompt: string, model: string = "anthropic/claude-3.5-sonnet") {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error("Worker failed");
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 4. JUDGE AI
 * Strict quality judge for AI agent outputs.
 */
export async function callJudgeAI(
  agent: any, 
  clientInput: string, 
  agentOutput: string, 
  model: string = JUDGE_MODEL,
  customPrompt?: string
) {
  const defaultPrompt = `You are a strict quality judge for AI agent outputs.
Your job: determine if the agent's response adequately addresses the client's input based on the agent's stated capabilities.

Agent capabilities: ${agent.description}
Agent category: ${agent.category}
Client input: ${clientInput}
Agent output: ${agentOutput}
Sample outputs from agent profile: ${JSON.stringify(agent.sample_outputs || [])}

Evaluate strictly:
1. Does the output address the client's request?
2. Is the quality consistent with sample outputs?
3. Is the output complete (not empty/error)?

Return JSON only in this exact format without markdown blocks:
{
  "verdict": true,
  "confidence": 95,
  "reasoning": "one sentence explanation"
}`;

  const finalPrompt = customPrompt ? customPrompt.replace("{output}", agentOutput) : defaultPrompt;

  const content = await callOpenRouter(model, finalPrompt, true);
  
  let cleanContent = content.trim();
  if (cleanContent.startsWith('```json')) {
    cleanContent = cleanContent.replace(/```json/g, '').replace(/```/g, '').trim();
  }
  return JSON.parse(cleanContent);
}
