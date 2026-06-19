import OpenAI from 'openai';

export interface OpenAIConfig {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
}

export function createOpenAI(config: OpenAIConfig) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    // node-fetch@2.7.0 (usado em alguns runtimes) tem bug intermitente com
    // gunzip de respostas chunked — gera ERR_STREAM_PREMATURE_CLOSE quando
    // a OpenAI fecha conexao abruptamente. Aumentamos retries do SDK pra
    // 5 (default 2) pra cobrir esses casos antes do job ser marcado failed.
    maxRetries: 5,
    // Default sao 600s; 90s e suficiente pra um turno do agent e libera
    // o worker pra retentar mais cedo se a conexao travar.
    timeout: 90_000,
  });
  return {
    client,
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
  };
}

export async function embed(
  ai: ReturnType<typeof createOpenAI>,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const res = await ai.client.embeddings.create({
    model: ai.embeddingModel,
    input: inputs,
  });
  return res.data.map((d) => d.embedding);
}
