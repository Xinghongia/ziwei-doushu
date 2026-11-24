import type { NextRequest } from 'next/server';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { buildChartContext } from '@/lib/ai/chart-context';
import { INTERPRET_SYSTEM } from '@/lib/ai/prompts';
import { errorStream, sseResponse, streamChat, type ChatMessage } from '@/lib/ai/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface InterpretBody {
  chart?: ZiweiChart;
  messages?: ChatMessage[];
}

export async function POST(req: NextRequest) {
  let body: InterpretBody;
  try {
    body = (await req.json()) as InterpretBody;
  } catch {
    return errorStream('请求体不是合法 JSON', 400);
  }

  const chart = body.chart;
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (!chart || !Array.isArray(chart.palaces) || chart.palaces.length === 0) {
    return errorStream('缺少命盘数据，请先在排盘页生成命盘', 400);
  }
  const usable = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  );
  if (usable.length === 0) {
    return errorStream('缺少提问内容', 400);
  }

  const system = `${INTERPRET_SYSTEM}

【命盘数据】
${buildChartContext(chart)}`;

  try {
    // 只带最近 20 轮，避免长对话把上下文吃满
    const stream = await streamChat(system, usable.slice(-20));
    return sseResponse(stream);
  } catch (err) {
    return errorStream(err instanceof Error ? err.message : '未知错误');
  }
}
