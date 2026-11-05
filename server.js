const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cases.json');

app.use(express.json());
app.use(express.static(__dirname));

function load() { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return []; } }
function save(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

const TEMPLATES = {
  will: {
    name: '遗嘱模板',
    fields: ['立遗嘱人', '配偶', '子女', '财产清单', '继承比例', '遗嘱执行人', '监护人（未成年子女）'],
    content: (d) => `遗嘱\n\n立遗嘱人：${d.testator || '___'}\n配偶：${d.spouse || '___'}\n子女：${d.children || '___'}\n\n财产清单：\n${d.assets || '1. 房产：___\n2. 存款：___\n3. 投资：___'}\n\n继承比例：\n${d.shares || '配偶 50%，子女各 25%'}\n\n遗嘱执行人：${d.executor || '___'}\n未成年子女监护人：${d.guardian || '___'}\n\n签名：___  日期：___`
  },
  agreement: {
    name: '赡养协议模板',
    fields: ['被赡养人', '赡养人', '赡养方式', '费用分摊', '居住安排', '争议解决'],
    content: (d) => `赡养协议\n\n被赡养人：${d.elder || '___'}\n赡养人：${d.caregiver || '___'}\n\n赡养方式：${d.method || '共同照顾 / 费用分摊 / 轮流居住'}\n费用分摊：${d.cost || '___'}\n居住安排：${d.housing || '___'}\n\n争议解决：${d.dispute || '家庭协商 → 调解 → 法院'}\n\n签名：___  日期：___`
  },
  checklist: {
    name: '遗产清单模板',
    fields: ['房产', '金融资产', '保险', '债务', '数字资产', ' sentimental 物品'],
    content: (d) => `遗产清单\n\n1. 房产：${d.property || '___'}\n2. 金融资产（存款/股票/基金）：${d.finance || '___'}\n3. 保险：${d.insurance || '___'}\n4. 债务：${d.debt || '___'}\n5. 数字资产（账号/加密货币）：${d.digital || '___'}\n6. 家庭纪念物品：${d.sentimental || '___'}\n\n总估算价值：${d.total || '___'}`
  }
};

const KNOWLEDGE = [
  { id: 'thai-inheritance', title: '泰国家庭继承法要点', tags: ['泰国', '继承', '女性权益'],
    content: '泰国继承法：法定继承人包括配偶、子女、父母、兄弟姐妹。女性与男性享有同等继承权。若无遗嘱，配偶继承一半，其余由子女平分。跨文化婚姻中，外籍配偶继承权受限，需通过遗嘱明确。' },
  { id: 'china-inheritance', title: '中国继承法要点', tags: ['中国', '继承', '遗嘱'],
    content: '中国继承法：法定继承顺序为配偶、子女、父母（第一顺序），兄弟姐妹、祖父母（第二顺序）。遗嘱继承优先于法定继承。公证遗嘱效力最高。' },
  { id: 'cross-border', title: '跨境继承注意事项', tags: ['跨境', '国际', '法律'],
    content: '跨境继承需考虑：1) 被继承人最后住所地法律；2) 不动产所在地法律；3) 遗嘱形式有效性；4) 税务影响；5) 汇率与资产转移。建议咨询当地律师。' },
  { id: 'dispute-mediation', title: '家庭纠纷调解路径', tags: ['调解', '纠纷', '家庭'],
    content: '推荐路径：1) 家庭内部协商；2) 第三方调解（社区/宗教/NGO）；3) 律师函协商；4) 诉讼。调解成功率高、成本低，建议优先尝试。' },
  { id: 'gender-equity', title: '性别平等与继承权益', tags: ['性别', '平等', '女性'],
    content: '现代法律普遍承认性别平等继承权。但实践中女性常面临"嫁出去的人"的歧视。建议：明确遗嘱、资产共同署名、婚姻财产协议。' },
  { id: 'elder-care', title: '赡养义务与养老安排', tags: ['赡养', '养老', '老人'],
    content: '赡养义务因国家而异。泰国：子女有赡养父母的法律义务。中国：赡养是法定义务。建议提前签订赡养协议，明确费用分摊与照顾轮换。' }
];

function assessRisk(family) {
  const risks = [];
  let score = 0;
  if (!family.hasWill) { risks.push('无遗嘱 → 法定继承可能不符合意愿'); score += 30; }
  if (family.childrenCount > 2 && !family.hasAgreement) { risks.push('多子女无赡养协议 → 照顾责任不清'); score += 20; }
  if (family.crossBorder) { risks.push('跨境资产 → 法律冲突风险'); score += 25; }
  if (family.hasDebt) { risks.push('存在债务 → 遗产分割复杂'); score += 15; }
  if (!family.hasInsurance) { risks.push('无保险 → 养老/医疗保障缺口'); score += 10; }
  const level = score >= 60 ? '高' : score >= 30 ? '中' : '低';
  return { score, level, risks };
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/templates', (req, res) => res.json(Object.entries(TEMPLATES).map(([k, v]) => ({ id: k, name: v.name, fields: v.fields }))));
app.post('/api/templates/:id/generate', (req, res) => {
  const t = TEMPLATES[req.params.id];
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({ id: req.params.id, name: t.name, content: t.content(req.body || {}) });
});

app.get('/api/knowledge', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const tag = req.query.tag;
  let list = KNOWLEDGE;
  if (tag) list = list.filter(k => k.tags.includes(tag));
  if (q) list = list.filter(k => k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q) || k.tags.some(t => t.toLowerCase().includes(q)));
  res.json(list);
});
app.get('/api/knowledge/tags', (req, res) => res.json([...new Set(KNOWLEDGE.flatMap(k => k.tags))]));

app.post('/api/assess', (req, res) => res.json(assessRisk(req.body || {})));

app.post('/api/cases', (req, res) => {
  const { familyName = '', members = [], assets = '', notes = '' } = req.body || {};
  const c = { id: crypto.randomUUID(), ts: new Date().toISOString(), familyName, members, assets, notes, risk: assessRisk(req.body || {}) };
  const all = load(); all.unshift(c); save(all.slice(0, 100));
  res.json(c);
});
app.get('/api/cases', (req, res) => res.json(load().map(c => ({ id: c.id, ts: c.ts, familyName: c.familyName, riskLevel: c.risk.level, riskScore: c.risk.score }))));
app.get('/api/cases/:id', (req, res) => { const c = load().find(x => x.id === req.params.id); if (!c) return res.status(404).json({ error: 'not found' }); res.json(c); });

app.listen(PORT, () => console.log(`Family Inheritance Planner running on http://localhost:${PORT}`));
