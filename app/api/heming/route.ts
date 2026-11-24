import type { NextRequest } from 'next/server';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { buildPairContext } from '@/lib/ai/chart-context';
import { HEMING_SYSTEM } from '@/lib/ai/prompts';
import { errorStream, sseResponse, streamChat, type ChatMessage } from '@/lib/ai/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface HeningBody {
  chartA?: ZiweiChart;
  chartB?: ZiweiChart;
  question?: string;
}

function validChart(c?: ZiweiChart): c is ZiweiChart {
  return !!c && Array.isArray(c.palaces) && c.palaces.length > 0;
}

export async function POST(req: NextRequest) {
  let body: HeningBody;
  try {
    body = (await req.json()) as HeningBody;
  } catch {
    return errorStream('请求体不是合法 JSON', 400);
  }

  const { chartA, chartB, question } = body;
  if (!validChart(chartA) || !validChart(chartB)) {
    return errorStream('缺少合盘所需的两个命盘数据', 400);
  }

  const ask = (question ?? '').trim() || '这两个人在一起合适吗？请从性格、情感互动、现实议题三方面分析，并给出相处建议。';

  const system = `${HEMING_SYSTEM}

${buildPairContext(chartA, chartB)}`;

  const messages: ChatMessage[] = [{ role: 'user', content: ask }];

  try {
    const stream = await streamChat(system, messages);
    return sseResponse(stream);
  } catch (err) {
    return errorStream(err instanceof Error ? err.message : '未知错误');
  }
}
