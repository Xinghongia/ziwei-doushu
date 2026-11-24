export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 模型配置全部走环境变量，换渠道不用改代码：
 *   AI_BASE_URL / AI_API_KEY / AI_MODEL
 * 默认值指向 tokenrhythm（1M 上下文，命盘文本再长也塞得下）。
 */
export function getLlmConfig(): LlmConfig {
  const baseUrl = (process.env.AI_BASE_URL || 'https://tokenrhythm.studio/v1').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = process.env.AI_MODEL || 'deepseek-v4.1-flash-1017';
  return { baseUrl, apiKey, model };
}

/** 统一的 SSE 响应头（含 nginx 不缓冲开关） */
function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 关键：不设这个 nginx 会把流攒起来，前端看起来像卡死
    'X-Accel-Buffering': 'no',
  };
}

/** 把一段纯文本当作一次性 SSE 流回给前端（用于错误提示） */
export function textStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

/**
 * 调 OpenAI 兼容接口，把上游的 choices[0].delta.content
 * 转成本项目前端认的 {@code data: {"delta":{"text":"..."}}} 格式。
 */
export async function streamChat(
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<ReadableStream<Uint8Array>> {
  const cfg = getLlmConfig();
  if (!cfg.apiKey) {
    throw new Error('未配置 AI_API_KEY');
  }

  const upstream = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      temperature: 0.7,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 300);
    throw new Error(`上游模型报错 HTTP ${upstream.status}: ${detail}`);
  }

  const reader = upstream.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = '';
      const push = (text: string) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`));
      const done = () => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      };

      try {
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') {
              done();
              return;
            }
            try {
              const json = JSON.parse(payload);
              const delta: string =
                json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
              if (delta) push(delta);
            } catch {
              /* 跳过不完整/非 JSON 的心跳行 */
            }
          }
        }
        done();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        push(`\n\n（流式中断：${msg}）`);
        done();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: sseHeaders() });
}

export function errorStream(message: string, status = 500): Response {
  return new Response(textStream(`解读失败：${message}`), {
    status,
    headers: sseHeaders(),
  });
}
