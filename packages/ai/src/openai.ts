import OpenAI from 'openai';

export interface OpenAIConfig {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
}

export function createOpenAI(config: OpenAIConfig) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    // CRITICO: forca o SDK a usar o fetch NATIVO do Node 18+ em vez do
    // node-fetch@2.7.0 (default em alguns ambientes). O node-fetch tem bug
    // recorrente com gunzip de respostas chunked da OpenAI gerando
    // ERR_STREAM_PREMATURE_CLOSE. Confirmado em prod: chamada direta com
    // fetch nativo retorna 200, mas via SDK falhava direto.
    fetch: globalThis.fetch,
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
