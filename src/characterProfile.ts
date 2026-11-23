// Character notes remain Markdown so backups, writing context and AI proposals share one source.
export const characterSections = [
  { title: '基础身份', fields: ['姓名', '性别', '年龄', '身份', '出身', '阵营', '社会地位'] },
  { title: '外貌特征', fields: ['身高', '体型', '面容', '发型', '服装', '标志性特征', '整体气质'] },
  { title: '性格特征', fields: ['核心性格', '优缺点', '性格反差', '情绪特点', '道德底线'] },
  { title: '心理动机', fields: ['人生目标', '核心欲望', '恐惧', '执念', '心理创伤', '价值观'] },
  { title: '语言习惯', fields: ['说话风格', '口头禅', '称呼习惯', '表达方式', '语气特点'] },
  { title: '行为习惯', fields: ['生活习惯', '兴趣爱好', '小动作', '特殊癖好', '行为模式'] },
  { title: '能力设定', fields: ['核心能力', '专业技能', '战斗实力', '特殊天赋', '弱点', '成长潜力'] },
  { title: '背景经历', fields: ['出生背景', '家庭', '童年', '重要经历', '人生转折点'] },
  { title: '人物关系', fields: ['亲属', '朋友', '师徒', '恋人', '敌人', '利益关系'] },
  { title: '立场利益', fields: ['所属势力', '立场', '利益诉求', '忠诚对象', '合作条件'] },
  { title: '成长弧线', fields: ['初始状态', '人物缺陷', '转折事件', '认知变化', '最终结局'] },
  { title: '剧情功能', fields: ['人物定位', '剧情作用', '支线', '伏笔', '出场章节'] },
] as const;
export type CharacterField = typeof characterSections[number]['fields'][number];
export type CharacterProfile = { fields: Partial<Record<CharacterField, string>>; extra: string };

export function parseCharacterProfile(body: string): CharacterProfile {
  const fields: CharacterProfile['fields'] = {}, extra: string[] = [];
  let section: typeof characterSections[number] | undefined;
  let field: CharacterField | undefined;
  let value: string[] = [];
  let supplemental = false;
  const flush = () => {
    if (field) fields[field] = [fields[field], value.join('\n').trim()].filter(Boolean).join('\n\n');
    value = []; field = undefined;
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (supplemental) { extra.push(line); continue; }
    if (field && line.startsWith('  ')) { value.push(line.slice(2)); continue; }
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      flush();
      const title = heading[1].replace(/\*\*/g, '').replace(/^\d+[.、．]\s*/, '').trim();
      if (title === '补充设定') { supplemental = true; section = undefined; continue; }
      section = characterSections.find(item => item.title === title);
      if (!section && title !== '补充设定') extra.push(line);
      continue;
    }
    const entry = line.match(/^\s*(?:[-*+]\s+)?(?:\*\*)?([^：:*]+?)(?:\*\*)?\s*[：:]\s*(?:\*\*)?(.*)$/u);
    const label = entry?.[1].trim() as CharacterField | undefined;
    if (section && label && (section.fields as readonly string[]).includes(label)) {
      flush(); field = label; value = [entry![2]];
    } else if (field) value.push(line);
    else extra.push(line);
  }
  flush();
  return { fields, extra: extra.join('\n').trim() };
}

export function formatCharacterProfile(profile: CharacterProfile, name: string): string {
  return [
    ...characterSections.map((section, index) => `## ${index + 1}. ${section.title}\n${section.fields.map(field => `- ${field}：${(field === '姓名' ? name : profile.fields[field] ?? '').trim().replace(/\n/g, '\n  ')}`).join('\n')}`),
    ...(profile.extra.trim() ? [`## 补充设定\n\n${profile.extra.trim()}`] : []),
  ].join('\n\n');
}

export const characterProfileRules = `人物档案按以下 12 类信息编写，body 使用 Markdown 二级标题“## 序号. 分类”和“- 字段：内容”。姓名与 title/name 一致。新人物逐项设计有具体差异、符合剧情的内容；尚未确定的信息留空，不用空泛套话。修改已有档案时保留未修改字段与补充设定，不得缩写成简介。\n${characterSections.map((section, index) => `${index + 1}. ${section.title}：${section.fields.join('、')}`).join('\n')}`;

export function characterSummary(body: string): string {
  const { fields, extra } = parseCharacterProfile(body);
  return [fields['身份'], fields['人物定位'], fields['核心性格'], fields['人生目标']].filter(Boolean).join(' · ') || extra;
}
