import type { ZiweiChart, Palace, Star } from '@/lib/ziwei/types';
import { STEMS, BRANCHES } from '@/lib/ziwei/constants';

const HOUR_LABEL = [
  '子时（23:00-01:00）', '丑时（01:00-03:00）', '寅时（03:00-05:00）', '卯时（05:00-07:00）',
  '辰时（07:00-09:00）', '巳时（09:00-11:00）', '午时（11:00-13:00）', '未时（13:00-15:00）',
  '申时（15:00-17:00）', '酉时（17:00-19:00）', '戌时（19:00-21:00）', '亥时（21:00-23:00）',
];

const TYPE_LABEL: Record<Star['type'], string> = {
  major: '主星',
  minor: '辅星',
  lucky: '吉星',
  sha: '煞星',
};

function fmtStar(s: Star): string {
  const b = s.brightnessRaw ? `（${s.brightnessRaw}）` : '';
  const h = s.siHua ? `【化${s.siHua}】` : '';
  return `${s.name}${b}${h}`;
}

function groupStars(palace: Palace): string[] {
  const out: string[] = [];
  (['major', 'minor', 'lucky', 'sha'] as Star['type'][]).forEach((t) => {
    const list = palace.stars.filter((s) => s.type === t);
    if (list.length) out.push(`${TYPE_LABEL[t]}：${list.map(fmtStar).join('、')}`);
  });
  if (!out.length) out.push('（无星）');
  if (palace.isEmpty) {
    const borrowed = palace.borrowedStars?.length
      ? palace.borrowedStars.join('、')
      : '对宫主星';
    out.push(`空宫，借${palace.borrowedFromName ?? '对宫'}的 ${borrowed}`);
  }
  if (palace.selfSihua?.length) {
    out.push(`宫干自化：${palace.selfSihua.map((s) => `${s.starName}化${s.siHua}`).join('、')}`);
  }
  return out;
}

/**
 * 把排盘引擎产出的结构化命盘，压成一份喂给大模型的中文文本。
 * 只保留解读需要的信息，避免把整个对象 JSON 化导致 token 爆炸。
 */
export function buildChartContext(chart: ZiweiChart): string {
  const b = chart.birthInfo;
  const li = chart.lunarInfo;
  const lines: string[] = [];

  lines.push('【出生信息】');
  const gender = b.gender === 'male' ? '男' : '女';
  lines.push(`性别：${gender}${chart.yinYangGender ? `（${chart.yinYangGender}）` : ''}`);
  if (b.name) lines.push(`姓名：${b.name}`);
  lines.push(
    `公历：${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')} ${HOUR_LABEL[b.hour] ?? ''}`,
  );
  if (b.origInput) {
    const o = b.origInput;
    lines.push(
      `（原始输入：${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')} ${String(o.clockHour).padStart(2, '0')}:${String(o.clockMinute).padStart(2, '0')}，已按子时换日规则处理）`,
    );
  }
  if (b.province || b.city) lines.push(`出生地：${[b.province, b.city].filter(Boolean).join(' ')}`);
  if (li) {
    const leap = li.isLeapMonth ? '闰' : '';
    lines.push(
      `农历：${STEMS[li.yearStem]}${BRANCHES[li.yearBranch]}年 ${leap}${Math.abs(li.lunarMonth)}月${li.lunarDay}日`,
    );
    if (li.fourPillars?.length === 4) lines.push(`四柱（节气口径）：${li.fourPillars.join(' ')}`);
  }
  lines.push(`五行局：${chart.wuxingJuName}`);
  lines.push(`命宫：${BRANCHES[chart.mingGongBranch]}宫　身宫：${BRANCHES[chart.shenGongBranch]}宫`);
  if (chart.mingZhu || chart.shenZhu) {
    lines.push(`命主：${chart.mingZhu ?? '—'}　身主：${chart.shenZhu ?? '—'}`);
  }
  lines.push('');

  lines.push('【十二宫】');
  chart.palaces.forEach((p, idx) => {
    const flags: string[] = [];
    if (p.isMingGong && p.name !== '命宫') flags.push('命宫');
    if (p.isShenGong && p.name !== '身宫') flags.push('身宫');
    if (p.isCurrentDaXian) flags.push('当前大限');
    const age = p.daXianAge ? `大限${p.daXianAge[0]}-${p.daXianAge[1]}岁` : '';
    const head = `${idx + 1}. ${p.name}（${STEMS[p.stem]}${BRANCHES[p.branch]}）`;
    const meta = [age, ...flags].filter(Boolean).join('，');
    lines.push(`${head}${meta ? ` — ${meta}` : ''}`);
    groupStars(p).forEach((s) => lines.push(`   · ${s}`));
  });
  lines.push('');

  if (chart.daXians?.length) {
    lines.push('【大限】');
    chart.daXians.forEach((d, i) => {
      const cur = i === chart.currentDaXianIndex ? ' ← 当前大限' : '';
      const stem = d.stemName ?? (typeof d.stemIndex === 'number' ? STEMS[d.stemIndex] : '');
      const branch = `${stem}${BRANCHES[d.palaceBranch]}宫`;
      const siHua = d.siHua
        ? `｜大限四化：${d.siHua.lu}化禄、${d.siHua.quan}化权、${d.siHua.ke}化科、${d.siHua.ji}化忌`
        : '';
      lines.push(`${i + 1}. ${d.startAge}-${d.endAge}岁 ${branch}（${d.palaceName}）${siHua}${cur}`);
    });
    lines.push('');
  }
  lines.push(`当前年龄：${chart.currentAge} 岁`);

  return lines.join('\n');
}

/** 合盘：两份命盘上下文拼接 */
export function buildPairContext(chartA: ZiweiChart, chartB: ZiweiChart): string {
  return [
    '══════ 甲方命盘 ══════',
    buildChartContext(chartA),
    '',
    '══════ 乙方命盘 ══════',
    buildChartContext(chartB),
  ].join('\n');
}
