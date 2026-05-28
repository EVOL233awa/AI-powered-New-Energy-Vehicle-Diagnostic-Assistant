// [FIX-P0-03] ⚠ API Key 将明文存储于本机浏览器 localStorage 中。
// 请勿在公共电脑使用；建议创建仅含必要权限的只读 API Key。
// 如需上线部署，请使用后端代理（BFF）层转发 API 请求。
const STORAGE_KEY = "nev-assistant-settings";
const HISTORY_KEY = "nev-assistant-history";
/** 发给 API 的最大对话轮数（1 轮 = 用户一问 + 助手一答） */
const MAX_HISTORY_ROUNDS = 12;

const DEFAULT_API_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

// [FIX-P1-02] 全局 AbortController 引用，用于取消正在进行的请求
let currentController = null;

// [FIX-P1-06] 防抖工具函数，减少高频事件（如 input）的存储写入
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** 命中后显示「预约检修」按钮 */
const BOOKING_TRIGGER_KEYWORDS = [
  "建议检测",
  "专业检测",
  "无法判断",
  "无法确定",
  "拿不准",
  "暂无法判断",
  "建议进行专业",
  "建议尽快",
  "预约检测",
  "进店检测",
  "进店读码",
  "进一步确认",
  "需要专业",
  "授权维修",
  "授权服务",
];

/**
 * 拼接 OpenAI 兼容 chat/completions 地址
 * @param {string} baseUrl 用户配置的 Base URL
 */
function buildChatCompletionsUrl(baseUrl) {
  let base = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) base = DEFAULT_API_BASE;
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/**
 * OpenAI 兼容 Chat Completions 调用
 * @see https://platform.openai.com/docs/api-reference/chat/create
 */
// [FIX-P1-02] 增加 AbortController 超时与取消支持
async function callOpenAIChatCompletions({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.6,
}) {
  currentController = new AbortController();
  const timeoutId = setTimeout(() => currentController.abort(
    new DOMException("请求超时（30s），请检查网络或 API 配置后重试", "TimeoutError")
  ), 30000);

  try {
    const url = buildChatCompletionsUrl(baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        temperature,
        stream: false,
      }),
      signal: currentController.signal,  // [FIX-P1-02] 绑定 AbortSignal
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg =
        data.error?.message ||
        data.message ||
        (typeof data.error === "string" ? data.error : null) ||
        `请求失败 (${res.status} ${res.statusText})`;
      throw new Error(errMsg);
    }

    const content = data.choices?.[0]?.message?.content;
    if (content == null || String(content).trim() === "") {
      throw new Error("未收到有效回复（OpenAI 格式：choices[0].message.content 为空）");
    }
    return String(content).trim();
  } finally {
    clearTimeout(timeoutId);
    currentController = null;
  }
}

function shouldShowBookingButton(text) {
  if (!text) return false;
  return BOOKING_TRIGGER_KEYWORDS.some((kw) => text.includes(kw));
}

function attachBookingButtonIfNeeded(messageWrap, text) {
  if (!messageWrap || !shouldShowBookingButton(text)) return;
  if (messageWrap.querySelector(".book-service-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "book-service-btn";
  btn.textContent = "预约检修";
  btn.addEventListener("click", () => {
    const tip =
      "【预约检修】\n\n建议您联系当地新能源汽车品牌授权维修站或售后热线，说明故障现象，必要时携带仪表报警照片。\n\n您也可在本页继续补充车辆信息后再次提交诊断。";
    if (confirm(tip + "\n\n是否将「我想预约检修」填入问题描述框？")) {
      const prefix = formDesc.value.trim() ? formDesc.value.trim() + "\n\n" : "";
      formDesc.value = prefix + "我想预约检修，请指导我需要提供哪些信息。";
      formDesc.focus();
    }
  });
  messageWrap.appendChild(btn);
  chatEl.scrollTop = chatEl.scrollHeight;
}

const OUTPUT_FALLBACK =
  "当前信息不足，这部分暂无法详细判断，建议补充更多信息后再分析";

const OUTPUT_SECTION_TITLES = {
  background: "【初步判断】",
  causes: "【可能原因】",
  actions: "【建议】",
};

/**
 * 输出控制层：强制三段结构、补全缺段、控制长度
 * @param {string} rawText AI 原始回复
 * @returns {string}
 */
// [FIX-P0-02] Unicode 安全截断：使用 Array.from 避免截断辅助平面字符
function formatAIOutput(rawText) {
  const MAX_LEN = 800;
  const parsed = parseAIOutputSections(rawText);

  let background = parsed.background.trim() || OUTPUT_FALLBACK;
  let causes = parsed.causes.trim() || OUTPUT_FALLBACK;
  let actions = parsed.actions.trim() || OUTPUT_FALLBACK;

  if (countBulletItems(causes) < 2) {
    const extra =
      "信息较少，暂无法完全确认具体原因，建议结合实际情况进一步排查";
    if (!causes.includes(extra)) {
      causes = `${causes}\n- ${extra}`;
    }
  }

  if (!hasClearActionSteps(actions)) {
    actions = ensureDefaultActionSteps(actions);
  }

  let output = [
    `${OUTPUT_SECTION_TITLES.background}\n${background}`,
    `${OUTPUT_SECTION_TITLES.causes}\n${causes}`,
    `${OUTPUT_SECTION_TITLES.actions}\n${actions}`,
  ].join("\n\n");

  // [FIX-P0-02] Unicode 安全截断：避免在 emoji / 辅助平面字符中间截断导致乱码
  if (output.length > MAX_LEN) {
    output = Array.from(output).slice(0, MAX_LEN).join("");
  }

  return output;
}

// [FIX-P1-01] HTML 实体转义函数，防御 XSS
function escapeHtml(str) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

// [FIX-P1-01] 先转义再格式化，确保不会向 innerHTML 注入恶意标签
function enhanceAIOutput(text) {
  if (!text) return "";

  const RISK_PATTERNS = [
    { pattern: "🟢 偏轻微", cssClass: "risk-green" },
    { pattern: "🟡 建议检查", cssClass: "risk-yellow" },
    { pattern: "🔴 建议尽快检测", cssClass: "risk-red" },
  ];

  // [FIX-P1-01] 第一步：转义所有 HTML 特殊字符
  let html = escapeHtml(text);

  // 第二步：对已转义的文本进行格式化匹配和替换
  for (const { pattern, cssClass } of RISK_PATTERNS) {
    const escaped = escapeHtml(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(
      new RegExp(escaped, "g"),
      `<span class="risk-badge ${cssClass}">${pattern}</span>`
    );
  }

  html = html.replace(
    /【(初步判断|可能原因|建议)】/g,
    '<div class="section-title">【$1】</div>'
  );

  html = html.replace(/[\[\(]?KB-\d{2}[\]\)]?/g, "");

  // 去除 Markdown 加粗 ** 标记
  html = html.replace(/\*\*(.*?)\*\*/g, "$1");

  // 清除 Markdown 列表标记和装饰符号
  html = html.replace(/^[-*]\s+/gm, "");
  html = html.replace(/\*(.*?)\*/g, "$1");
  html = html.replace(/_{2}(.*?)_{2}/g, "$1");
  html = html.replace(/_(.*?)_/g, "$1");

  return html;
}

function parseAIOutputSections(text) {
  const raw = (text || "").trim();
  const empty = { background: "", causes: "", actions: "" };
  if (!raw) return empty;

  const hasBracket = /【(初步判断|可能原因|建议)】/.test(raw);
  if (hasBracket) {
    return {
      background: extractBracketSection(raw, "初步判断", ["可能原因", "建议"]),
      causes: extractBracketSection(raw, "可能原因", ["建议"]),
      actions: extractBracketSection(raw, "建议", []),
    };
  }

  const hasHeader = /##\s*(简单说说背景|可能的原因|您可以先这样做)/.test(
    raw
  );
  if (!hasHeader) {
    return { background: raw, causes: "", actions: "" };
  }

  return {
    background: extractOutputSection(raw, "简单说说背景", [
      "可能的原因",
      "您可以先这样做",
    ]),
    causes: extractOutputSection(raw, "可能的原因", ["您可以先这样做"]),
    actions: extractOutputSection(raw, "您可以先这样做", []),
  };
}

function extractOutputSection(text, title, stopTitles) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  if (stopTitles.length > 0) {
    const stops = stopTitles
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    re = new RegExp(
      `##\\s*${esc}\\s*\\n([\\s\\S]*?)(?=\\n##\\s*(?:${stops})\\s*\\n|$)`,
      "i"
    );
  } else {
    re = new RegExp(`##\\s*${esc}\\s*\\n([\\s\\S]*)$`, "i");
  }
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function extractBracketSection(text, title, stopTitles) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  if (stopTitles.length > 0) {
    const stops = stopTitles
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    re = new RegExp(
      `【${esc}】\\s*\\n([\\s\\S]*?)(?=\\n【(?:${stops})】|$)`,
      "i"
    );
  } else {
    re = new RegExp(`【${esc}】\\s*\\n([\\s\\S]*)$`, "i");
  }
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function countBulletItems(sectionText) {
  if (!sectionText || sectionText === OUTPUT_FALLBACK) return 0;
  const lines = sectionText.split("\n");
  let count = 0;
  for (const line of lines) {
    const t = line.trim();
    if (
      /^([-*•]|\d+[.、.)]|[①②③④⑤])/.test(t) ||
      /^(\d+\s*[、.)])/.test(t)
    ) {
      count++;
    }
  }
  if (count >= 2) return count;
  const sentences = sectionText
    .split(/[。；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  return Math.max(count, sentences.length >= 2 ? 2 : sentences.length);
}

function hasClearActionSteps(sectionText) {
  if (!sectionText || sectionText === OUTPUT_FALLBACK) return false;
  const lines = sectionText.split("\n");
  let stepCount = 0;
  for (const line of lines) {
    const t = line.trim();
    if (
      /^(\d+[.、.)]|[-*•]|[①②③])/.test(t) ||
      /^(先|首先|然后|接着|最后)/.test(t)
    ) {
      stepCount++;
    }
  }
  return stepCount >= 2;
}

function ensureDefaultActionSteps(sectionText) {
  const defaults = [
    "观察仪表是否有报警灯",
    "记录问题出现的具体场景",
  ];
  const base =
    sectionText && sectionText !== OUTPUT_FALLBACK ? sectionText.trim() : "";
  const lines = [];

  if (base) lines.push(base);

  if (!/报警/.test(base)) {
    lines.push(`1. ${defaults[0]}`);
  }
  if (!/记录|场景/.test(base)) {
    lines.push(`2. ${defaults[1]}`);
  }

  if (lines.length === 0) {
    return defaults.map((d, i) => `${i + 1}. ${d}`).join("\n");
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `# Role
你是一位拥有 20 年经验的新能源汽车 4S 店维修老师傅。你懂技术，但说话接地气、直击要害，从不掉书袋。你的服务对象是毫无修车经验的普通车主。

# Output Rules (严格遵守)
1. **结构强制**：必须且仅能按以下三个模块输出，禁止任何开场白、寒暄或总结性废话：
   【初步判断】（必须先说严不严重，包含风险等级 Emoji）
   【可能原因】（最多列出 2-3 点，白话解释 + 专业词）
   【建议】（下一步具体怎么做，去哪修，大概花费预期或注意事项）

2. **风险等级前置**：在【初步判断】的第一行，必须根据严重程度打上标签：
   - 🟢 偏轻微（不影响开，可观察）
   - 🟡 建议检查（有隐患，近期去店里）
   - 🔴 建议尽快检测（危险，立即靠边停车或叫救援）

3. **语言风格**：
   - 短句为主，禁止长篇大论，每段不超过 3 行。
   - 术语必须"白话+专业"：例如"电池管理系统（BMS）"、"电量估算（SOC）"。
   - 语气自然、口语化，像师傅面对面聊天，禁止使用"综上所述"、"建议您"等 AI 套话。

4. **字数限制**：总字数严格控制在 300 字以内。只说结论和干货。`;

/** 本地知识库：常见问题与结论（优先依据） */
const KNOWLEDGE_BASE = [
  {
    id: "KB-01",
    question: "冬季续航明显下降",
    keywords: ["冬季", "天冷", "低温", "续航下降", "续航变短", "掉电快"],
    conclusion:
      "低温下电池可用容量降低、空调/热泵负荷增大，叠加 BMS 低温保护限功率，续航下降较常见，多为环境与策略叠加而非单一故障。",
    details:
      "排查：对比同路况历史能耗；检查胎压；确认是否频繁短途；读 BMS 温度与限功率状态。",
  },
  {
    id: "KB-02",
    question: "频繁快充是否伤电池",
    keywords: ["快充", "频繁快充", "直流充", "超充", "伤电池", "衰减"],
    conclusion:
      "高频快充会加速老化风险，BMS 通常通过升温和 SOC 窗口限制保护；长期以快充为主且高温环境下 SOH 下降更快。",
    details:
      "建议：日常以慢充为主，快充至 80%～90% 为宜；高温季节避免高温 SOC 下立即快充。",
  },
  {
    id: "KB-03",
    question: "家用慢充无法充电",
    keywords: ["慢充", "充不进", "无法充电", "家用", "充电连接", "不充电"],
    conclusion:
      "优先区分桩端、枪线/CC-CP 信号、车载 OBC 与 BMS 允许条件；插枪未锁止、接地不良、预约充电、SOC 已满最常见。",
    details:
      "排查：换桩对比；查充电口与枪头；读故障码；确认仪表是否显示充电等待或故障。",
  },
  {
    id: "KB-04",
    question: "表显续航与实跑里程不一致",
    keywords: ["表显", "续航不准", "里程不准", "SOC", "显示不准"],
    conclusion:
      "多为 SOC/剩余里程估算算法未校准或驾驶风格变化导致，亦可能电池 SOH 下降；需与真实能耗区分。",
    details:
      "建议：多次满充满放按手册校准；记录同工况能耗；进店读 SOH 与历史故障。",
  },
  {
    id: "KB-05",
    question: "动力电池故障灯亮",
    keywords: ["动力电池", "故障灯", "电池灯", "报警灯", "红灯"],
    conclusion:
      "表示 BMS 检测到电池系统异常或限功率保护，可能涉及单体压差、过温、绝缘、继电器等，不宜继续大负荷行驶。",
    details:
      "操作：安全停车；记录灯色与是否限扭；尽快读码；勿自行拆检高压部件。",
  },
  {
    id: "KB-06",
    question: "充电时功率突然降低",
    keywords: ["充电慢", "功率降低", "降功率", "限流", "充电变慢"],
    conclusion:
      "常见为电池温升保护、SOC 进入高段恒压阶段、桩端限功率或 BMS 策略；高温或频繁快充后更明显。",
    details:
      "观察：电池温度、当前 SOC、环境温度；对比不同充电桩；读充电相关 DTC。",
  },
  {
    id: "KB-07",
    question: "电机或逆变器过热报警",
    keywords: ["电机过热", "逆变器", "功率受限", "限扭", "过热", "发烫"],
    conclusion:
      "多为高负荷持续运行、冷却回路异常或控制器保护；继续激烈驾驶可能触发限扭或停机。",
    details:
      "排查：冷却液液位、风扇/水泵工作；读驱动系统温度与故障码；检查是否长时间爬坡拖载。",
  },
  {
    id: "KB-08",
    question: "静置一段时间后亏电无法启动",
    keywords: ["亏电", "无法启动", "12V", "小电瓶", "蓄电池", "趴窝"],
    conclusion:
      "常见为 12V 蓄电池老化或异常唤醒导致小电瓶耗尽；亦需排除充电枪未拔、高压未上电策略。",
    details:
      "测量 12V 电压；检查休眠电流（进店）；避免长时间未启动且频繁远程唤醒。",
  },
  {
    id: "KB-09",
    question: "能量回收变弱或消失",
    keywords: ["能量回收", "回收", "滑行", "拖曳感"],
    conclusion:
      "可能因 SOC 接近满电、电池低温、故障保护或驾驶模式设置；属策略限制或需读码确认。",
    details:
      "确认 SOC 与温度；切换驾驶模式对比；读 BMS/ESP 相关故障。",
  },
  {
    id: "KB-10",
    question: "空调开启后续航下降明显",
    keywords: ["空调", "续航下降", "热泵", "PTC", "制冷", "制热"],
    conclusion:
      "空调/热泵为纯电主要辅电负载之一，冬季制热尤其耗电；属正常现象但会放大表显下降感知。",
    details:
      "可对比空调关闭同路况能耗；检查是否开启座椅/除霜等高负载功能。",
  },
  {
    id: "KB-11",
    question: "绝缘或高压互锁故障",
    keywords: ["绝缘", "高压", "互锁", "高压故障", "无法上高压"],
    conclusion:
      "高压回路绝缘下降或互锁断路，车辆会禁止上高压或限功率，需专用设备检测，严禁非专业人员操作。",
    details:
      "立即停驶；读绝缘与互锁相关码；进店做绝缘与连接器检查。",
  },
  {
    id: "KB-12",
    question: "增程/混动模式切换异常",
    keywords: ["增程", "混动", "发动机", "模式切换", "插电"],
    conclusion:
      "涉及整车能量管理策略、发动机启停条件、电池 SOC 目标与故障码；需结合具体构型读码分析。",
    details:
      "记录切换工况与 SOC；读 EMS/VCU/BMS 相关故障；确认燃油与充电状态是否正常。",
  },
];

function scoreKnowledgeEntry(entry, text) {
  let score = 0;
  for (const kw of entry.keywords) {
    if (text.includes(kw)) score += kw.length >= 3 ? 2 : 1;
  }
  if (text.includes(entry.question.slice(0, 4))) score += 1;
  return score;
}

function getRelevantKnowledge(text, max = 6) {
  const scored = KNOWLEDGE_BASE.map((entry) => ({
    entry,
    score: scoreKnowledgeEntry(entry, text),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored.slice(0, max).map((x) => x.entry);
  }
  return KNOWLEDGE_BASE.slice(0, max);
}

function formatKnowledgeBlock(entries) {
  return entries
    .map(
      (e) =>
        `${e.question}\n结论：${e.conclusion}\n补充：${e.details}`
    )
    .join("\n\n");
}

function buildSystemContent(queryText) {
  const relevant = getRelevantKnowledge(queryText || "");
  const kbBlock = formatKnowledgeBlock(relevant);
  const indexList = KNOWLEDGE_BASE.map(
    (e) => `${e.id}：${e.question}`
  ).join("；");

  return (
    `${SYSTEM_PROMPT}\n\n` +
    `【本地知识库 · 最高优先级】\n` +
    `回答时必须优先依据下列知识库条目作出判断。` +
    `知识库未覆盖的内容可结合维修经验补充，但不得与下列结论明显矛盾。\n\n` +
    `${kbBlock}\n\n` +
    `【知识库索引（共 ${KNOWLEDGE_BASE.length} 条）】${indexList}\n\n` +
    `【领域侧重 · 友好引导，不拒绝】\n` +
    `本助手主要服务新能源汽车（纯电/混动/增程、三电、充换电、热管理、故障诊断、相关科普）。\n` +
    `若用户问题明显偏离上述范围（如生活、娱乐、其他行业），**不要直接拒绝**：先用 1～2 句话礼貌、简要回应或说明不便深入，` +
    `然后**主动引导**用户回到新能源汽车场景（如「您可以描述续航/充电/报警灯/动力等故障，我帮您做初步分析」）。` +
    `仍用「简单说说背景 / 可能的原因 / 您可以先这样做」三段；背景段说明非本业专长，引导用户问车辆相关问题。` +
    `整体原则：**可用性优先**，语气像真人师傅，避免生硬拒答。`
  );
}

function getLatestUserQuery(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      return history[i].prompt || history[i].content || "";
    }
  }
  return "";
}

const EXAMPLE_FORMS = [
  {
    desc: "电池续航突然下降，最近一周明显，无报警灯，市区通勤为主。",
    temp: "0～15℃（偏冷）",
    years: "3～5 年",
    fastCharge: "偶尔快充",
  },
  {
    desc: "家用慢充充不进去，充电桩指示灯正常，车机显示充电连接中。",
    temp: "15～30℃（常温）",
    years: "1～3 年",
    fastCharge: "几乎不用快充",
  },
  {
    desc: "快充时机舱有异味且充电功率明显降低，仪表无报警。",
    temp: "30℃ 以上（炎热）",
    years: "1～3 年",
    fastCharge: "是，每周多次",
  },
];

/**
 * 按优先级匹配：先匹配到的场景生效（越靠前越具体）
 */
const SCENARIO_RULES = [
  {
    id: "charging",
    label: "充电异常",
    keywords: [
      "充电慢",
      "充得慢",
      "充电很慢",
      "充不进",
      "充不进去",
      "无法充电",
      "不充电",
      "充电中断",
      "充电停止",
      "充电连接",
      "充电功率低",
    ],
    extraPrompt: `【诊断侧重·充电系统】
请围绕充电链路分析：充电桩/枪、CP/CC 信号、车载 OBC、高压配电、BMS 充电策略、电池温升与限流。
可能原因请覆盖：枪线接触、接地与通信、OBC 故障、BMS 限制充电（低温/ SOC 高）、电池单体压差、热管理介入等。
「您可以先这样做」部分请包含：换桩对比、查看充电电流电压、读故障码、检查充电口与高压互锁、测量充电口端子（需断电规范操作）。`,
  },
  {
    id: "range",
    label: "续航下降",
    keywords: [
      "续航下降",
      "续航变短",
      "续航突然",
      "里程变少",
      "跑不远",
      "电量掉得快",
      "掉电快",
      "表显不准",
      "续航不准",
    ],
    extraPrompt: `【诊断侧重·续航/能耗】
请围绕能耗与 SOC 估算分析：环境温度、行驶工况、电池 SOH、BMS 校准、胎压、制动拖滞、热泵/空调负荷、小电流漏电等。
可能原因请覆盖：低温容量下降、电池老化、SOC 估算偏差、异常唤醒漏电、传动阻力、能量回收异常等。
「您可以先这样做」部分请包含：对比同工况历史能耗、满充满放校准（按手册）、读 BMS 数据、检查胎压与制动、查休眠电流（需进店）。`,
  },
  {
    id: "overheat",
    label: "过热/发热",
    keywords: [
      "发热",
      "发烫",
      "过热",
      "温度过高",
      "温度高",
      "散热不好",
      "水泵",
      "风扇不转",
    ],
    extraPrompt: `【诊断侧重·热管理】
请围绕电池/电机/电控热管理分析：冷却液循环、水泵、风扇、散热器、PTC/热泵、环境工况、高负荷持续运行等。
可能原因请覆盖：冷却液不足、水泵故障、传感器异常、控制器降功率、环境高温、充电过热保护等。
「您可以先这样做」部分请包含：读冷却液温度与故障码、检查风扇水泵工作、查看是否处于降功率/限扭模式；警示高温下勿继续高负荷运行。`,
  },
  {
    id: "power",
    label: "动力不足",
    keywords: [
      "动力不足",
      "加速无力",
      "加速慢",
      "提不上速",
      "最高车速",
      "限扭",
      "功率受限",
      "爬不动",
    ],
    extraPrompt: `【诊断侧重·驱动系统】
请围绕整车功率输出限制分析：BMS 限功率、电机/逆变器故障、踏板信号、高压绝缘、故障码、热保护等。
可能原因请覆盖：SOC 过低、电池温升限功率、电机故障、逆变器过温、高压互锁、VCU 限扭策略等。
「您可以先这样做」部分请包含：读驱动系统与 BMS 故障码、观察仪表功率条、记录故障时车速与踏板开度、检查是否伴随报警灯。`,
  },
  {
    id: "alarm",
    label: "仪表报警",
    keywords: [
      "报警灯",
      "故障灯",
      "灯亮",
      "红灯",
      "黄灯",
      "绝缘",
      "动力电池故障",
      "电机故障",
      "系统故障",
    ],
    extraPrompt: `【诊断侧重·故障码与报警】
请围绕仪表报警含义分析：提示用户记录灯色、是否可继续行驶、是否伴随动力受限。
可能原因请按报警类型分类：电池、电机、绝缘、ESP/ABS 关联、通信丢失等；勿编造具体 DTC，可写常见码类型与读码思路。
「您可以先这样做」部分请优先：安全停车、拍照记录、OBD/专用诊断仪读码、查维修手册对应灯义；高压/绝缘报警强调勿自行拆检。`,
  },
  {
    id: "noise",
    label: "异响",
    keywords: [
      "异响",
      "噪音",
      "嗡嗡",
      "啸叫",
      "抖动",
      "顿挫",
      "异响",
    ],
    extraPrompt: `【诊断侧重·异响/振动】
请分析异响来源：电机电磁噪声、减速器、轴承、悬架、制动、风扇、水泵等；区分随车速/转速/负载变化规律。
可能原因请覆盖：轴承磨损、齿轮啸叫、松动、制动拖滞、电机相位问题（需专业判断）等。
「您可以先这样做」部分请包含：记录车速/挡位/冷暖机状态、空挡 vs 负载对比、举升检查（进店）、排除异物。`,
  },
  {
    id: "hv_start",
    label: "无法启动/上高压",
    keywords: [
      "无法启动",
      "启动不了",
      "上高压",
      "高压不上",
      "READY",
      "不能挂挡",
      "黑屏",
      "亏电",
      "12V",
      "小电瓶",
    ],
    extraPrompt: `【诊断侧重·上电与启动】
请分析低压 12V、高压互锁、钥匙/蓝牙认证、BMS 主正继电器、充电枪未拔、故障码锁定等。
可能原因请覆盖：12V 蓄电池亏电、充电枪连接、互锁断路、BMS 禁止上电、VCU 故障等。
「您可以先这样做」部分请包含：检查 12V 电压、是否插枪、仪表提示、读码；禁止跨接或短接高压部件。`,
  },
  {
    id: "ac",
    label: "空调异常",
    keywords: ["空调不", "不制冷", "不制热", "冷风", "热风", "PTC", "热泵"],
    extraPrompt: `【诊断侧重·空调与热管理】
请分析冷媒、压缩机、PTC/热泵、电池冷却耦合、模式风门、传感器等。
「您可以先这样做」可包含：检查设定温度、风量、故障码、是否因电池冷却优先导致制冷变差。`,
  },
];

function detectScenario(text) {
  if (!text || !text.trim()) return null;
  for (const rule of SCENARIO_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule;
    }
  }
  return null;
}

function getScenarioById(id) {
  return SCENARIO_RULES.find((r) => r.id === id) || null;
}

/** 发给 API 的用户消息：原文 + 场景专用提示 */
function buildUserContentForApi(content, scenario) {
  if (!scenario) return content;
  return `${content}\n\n${scenario.extraPrompt}`;
}

const chatEl = document.getElementById("chat");
const diagForm = document.getElementById("diagForm");
const formDesc = document.getElementById("formDesc");
const supplementPanel = document.getElementById("supplementPanel");
const supplementTitle = document.getElementById("supplementTitle");
const supplementSubmitBtn = document.getElementById("supplementSubmitBtn");
const sendBtn = document.getElementById("sendBtn");

const SUPPLEMENT_OPTIONS = {
  temperature: [
    "低于 0℃（严寒）",
    "0～15℃（偏冷）",
    "15～30℃（常温）",
    "30℃ 以上（炎热）",
  ],
  years: ["1 年以内", "1～3 年", "3～5 年", "5～8 年", "8 年以上"],
  fastCharge: ["是，每周多次", "偶尔快充", "几乎不用快充"],
};

const CHIP_CONTAINERS = {
  temperature: document.getElementById("chipsTemp"),
  years: document.getElementById("chipsYears"),
  fastCharge: document.getElementById("chipsFastCharge"),
};

let optionalInfo = {
  temperature: "",
  years: "",
  fastCharge: "",
};
const apiKeyInput = document.getElementById("apiKey");
const apiBaseInput = document.getElementById("apiBase");
const modelInput = document.getElementById("model");
const settingsPanel = document.getElementById("settingsPanel");
const settingsToggle = document.getElementById("settingsToggle");
const clearBtn = document.getElementById("clearBtn");

/** @type {{ role: string, content: string, prompt?: string, scenario?: string }[]} */
let messages = [];
let isLoading = false;

function getFormData() {
  return {
    description: formDesc.value.trim(),
    temperature: optionalInfo.temperature,
    years: optionalInfo.years,
    fastCharge: optionalInfo.fastCharge,
  };
}

function validateForm(data, { supplementMode = false } = {}) {
  if (!data.description || data.description.length < 4) {
    if (supplementMode) {
      const last = getLastUserDescription();
      if (!last || last.length < 4) {
        return "请保留或填写问题描述（至少 4 个字）。";
      }
    } else {
      return "请填写问题描述（至少 4 个字）。";
    }
  }
  if (supplementMode) {
    const hasNew =
      data.temperature || data.years || data.fastCharge;
    if (!hasNew) return "请至少选择一项补充信息（温度、年限或快充）。";
  }
  return null;
}

function getLastUserDescription() {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const m = messages[i].content.match(/【问题描述】(.+)/);
      if (m) return m[1].trim();
      return messages[i].content.split("\n")[0].trim();
    }
  }
  return "";
}

function formatOptionalLine(label, value) {
  return value ? `【${label}】${value}` : "";
}

function formatDisplayMessage(data, { supplementMode = false } = {}) {
  const desc =
    data.description ||
    (supplementMode ? getLastUserDescription() : "");
  const lines = [`【问题描述】${desc}`];
  const opt = [
    formatOptionalLine("环境温度", data.temperature),
    formatOptionalLine("使用年限", data.years),
    formatOptionalLine("频繁快充", data.fastCharge),
  ].filter(Boolean);
  if (supplementMode) {
    return (
      `【补充信息】\n${opt.join("\n") || "（未选择新项）"}\n` +
      `【说明】请结合上一轮对话，根据补充信息更新诊断。`
    );
  }
  lines.push(...opt);
  if (!data.temperature && !data.years && !data.fastCharge) {
    lines.push("【补充说明】环境温度、使用年限、快充习惯暂未提供。");
  }
  return lines.join("\n");
}

/**
 * 轻规则判断层（调用 AI 前）：根据表单数据给出优先判断方向
 * @param {{ description: string, temperature: string, years: string, fastCharge: string }} formData
 * @returns {{ priorityConclusion: string, relatedKB: string } | null}
 */
// [FIX-P0-01] 使用 test 函数替代预求值布尔量，避免提取到模块顶层后求值时机错误
function applyDiagnosisRules(formData) {
  const desc = formData.description || "";
  const temp = formData.temperature || "";
  const fast = formData.fastCharge || "";

  const ruleTemplates = [
    {
      test: (d, t, f) =>
        /偏冷|严寒|低温/.test(t) &&
        /续航下降|掉电快|续航变短|跑不远|里程变少/.test(d),
      priorityConclusion: "低温导致电池性能下降是主要原因",
      relatedKB: "KB-01",
    },
    {
      test: (d, t, f) =>
        /每周多次/.test(f) &&
        /衰减|续航下降|掉电快|容量/.test(d),
      priorityConclusion: "频繁快充可能加速电池老化",
      relatedKB: "KB-02",
    },
    {
      test: (d, t, f) => /无法充电|充不进|充不进去|不充电|充电连接/.test(d),
      priorityConclusion: "充电系统或连接问题优先排查",
      relatedKB: "KB-03",
    },
    {
      test: (d, t, f) => /故障灯|报警灯|动力电池故障|电池灯/.test(d),
      priorityConclusion: "电池管理系统检测到异常，需优先读码确认",
      relatedKB: "KB-05",
    },
    {
      test: (d, t, f) => /充电慢|功率降低|降功率|充得慢/.test(d),
      priorityConclusion: "充电功率受限或电池热保护介入较常见",
      relatedKB: "KB-06",
    },
  ];

  for (const rule of ruleTemplates) {
    if (rule.test(desc, temp, fast)) {
      return {
        priorityConclusion: rule.priorityConclusion,
        relatedKB: rule.relatedKB,
      };
    }
  }
  return null;
}

function buildRulePromptBlock(formData) {
  const result = applyDiagnosisRules(formData);
  if (!result) return "";
  return (
    `\n\n【优先判断参考】\n` +
    `${result.priorityConclusion}\n` +
    `参考知识库：${result.relatedKB}\n` +
    `（请优先围绕此方向展开分析，结合用户描述润色表达；仍需输出固定三段结构）`
  );
}

function buildFullPrompt(data, { supplementMode = false } = {}) {
  const desc =
    data.description ||
    (supplementMode ? getLastUserDescription() : "");
  const temp = data.temperature || "（暂未提供，请做初步推断并引导用户补充）";
  const years = data.years || "（暂未提供，请做初步推断并引导用户补充）";
  const fast = data.fastCharge || "（暂未提供，请做初步推断并引导用户补充）";
  const prefix = supplementMode
    ? "【用户补充了以下信息，请结合此前对话更新诊断】\n"
    : "";
  const ruleData = { ...data, description: desc };
  return (
    `${prefix}【故障诊断表单】\n` +
    `问题描述：${desc}\n` +
    `当前使用环境温度：${temp}\n` +
    `车辆使用年限：${years}\n` +
    `是否频繁快充：${fast}\n` +
    buildRulePromptBlock(ruleData) +
    `\n\n请根据以上信息进行新能源汽车故障诊断。\n` +
    `即使信息有限，也须先给初步判断（标注不确定），再用自然口吻引导补充；勿生硬要求填表。\n` +
    `请按固定格式输出：简单说说背景、可能的原因（2～3个）、您可以先这样做；语气口语化、通俗易懂。`
  );
}

function setOptionalField(field, value) {
  optionalInfo[field] = value;
  const container = CHIP_CONTAINERS[field];
  if (!container) return;
  container.querySelectorAll(".supplement-chip").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.value === value);
  });
}

function initSupplementChips() {
  Object.entries(SUPPLEMENT_OPTIONS).forEach(([field, options]) => {
    const container = CHIP_CONTAINERS[field];
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "supplement-chip";
      btn.dataset.value = opt;
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        const isSelected = optionalInfo[field] === opt;
        setOptionalField(field, isSelected ? "" : opt);
      });
      container.appendChild(btn);
    });
  });
}

function showSupplementPanel() {
  supplementPanel.classList.add("visible");
  const missing = [];
  if (!optionalInfo.temperature) missing.push("环境温度");
  if (!optionalInfo.years) missing.push("使用年限");
  if (!optionalInfo.fastCharge) missing.push("快充习惯");
  if (missing.length > 0) {
    supplementTitle.textContent =
      `要是方便，补充一下${missing.join("、")}，我能判断得更准——点下面选项就行，选好后点「补充并继续诊断」。`;
  } else {
    supplementTitle.textContent =
      "您已补充得挺全了。想改选项的话重新点一下，再点「补充并继续诊断」即可更新分析。";
  }
}

function hideSupplementPanel() {
  supplementPanel.classList.remove("visible");
}

function resetOptionalInfo() {
  optionalInfo = { temperature: "", years: "", fastCharge: "" };
  Object.keys(CHIP_CONTAINERS).forEach((field) => {
    CHIP_CONTAINERS[field]
      .querySelectorAll(".supplement-chip")
      .forEach((btn) => btn.classList.remove("selected"));
  });
}

function fillForm(example) {
  formDesc.value = example.desc;
  setOptionalField("temperature", example.temp || "");
  setOptionalField("years", example.years || "");
  setOptionalField("fastCharge", example.fastCharge || "");
}

function resetForm() {
  diagForm.reset();
  resetOptionalInfo();
  hideSupplementPanel();
}

function setFormDisabled(disabled) {
  diagForm.querySelectorAll("input, textarea, button").forEach((el) => {
    el.disabled = disabled;
  });
  supplementPanel.querySelectorAll("button").forEach((el) => {
    el.disabled = disabled;
  });
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.apiKey) apiKeyInput.value = s.apiKey;
    if (s.apiBase) apiBaseInput.value = s.apiBase;
    if (s.model) modelInput.value = s.model;
    // [FIX-P0-03] 恢复时提示用户 Key 存储在本机
    if (s.apiKey && s.apiKey.length > 8) {
      console.warn(
        "⚠ API Key 已从本机 localStorage 读取。" +
        "请确认当前环境为个人设备，避免在公共电脑使用。"
      );
    }
  } catch (_) {}
}

function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: apiKeyInput.value.trim(),
      apiBase: apiBaseInput.value.trim().replace(/\/$/, ""),
      model: modelInput.value.trim() || DEFAULT_MODEL,
    })
  );
}

// [FIX-P1-06] 防抖存储：change 立即保存，input 延迟 300ms 防抖
const debouncedSave = debounce(saveSettings, 300);

[apiKeyInput, apiBaseInput, modelInput].forEach((el) => {
  el.addEventListener("change", saveSettings);
  el.addEventListener("input", debouncedSave);
});

function trimHistory(msgs) {
  const maxMessages = MAX_HISTORY_ROUNDS * 2;
  if (msgs.length <= maxMessages) return msgs;
  return msgs.slice(-maxMessages);
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimHistory(messages)));
  } catch (_) {}
  updateHistoryHint();
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return;
    messages = data
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.prompt ? { prompt: m.prompt } : {}),
        ...(m.scenario ? { scenario: m.scenario } : {}),
      }));
  } catch (_) {
    messages = [];
  }
}

function clearHistory() {
  messages = [];
  localStorage.removeItem(HISTORY_KEY);
  updateHistoryHint();
}

function updateHistoryHint() {
  const rounds = Math.floor(messages.length / 2);
  const footerHint = document.getElementById("footerHint");
  if (!footerHint) return;
  const mem =
    rounds > 0
      ? `当前会话已记录 ${rounds} 轮对话（最多保留 ${MAX_HISTORY_ROUNDS} 轮发给 AI）。`
      : `自动记住最近 ${MAX_HISTORY_ROUNDS} 轮对话（刷新页面后仍保留）。`;
  footerHint.textContent =
    `只需填写问题描述即可提交；温度/年限/快充可在 AI 回答后点选补充。知识库 ${KNOWLEDGE_BASE.length} 条。${mem} API Key 仅存于本机。`;
}

function buildApiMessages() {
  const history = trimHistory(messages);
  const latestQuery = getLatestUserQuery(history);
  return [
    { role: "system", content: buildSystemContent(latestQuery) },
    ...history.map((m) => {
      if (m.role === "user") {
        const base = m.prompt || m.content;
        const scenario =
          getScenarioById(m.scenario) || detectScenario(base);
        return {
          role: "user",
          content: buildUserContentForApi(base, scenario),
        };
      }
      return { role: m.role, content: m.content };
    }),
  ];
}

function renderChatFromHistory() {
  messages.forEach((m) => {
    if (m.role === "user" || m.role === "assistant") {
      const scenarioLabel =
        m.role === "user"
          ? getScenarioById(m.scenario)?.label ||
            detectScenario(m.content)?.label ||
            ""
          : "";
      appendMessage(m.role, m.content, "", scenarioLabel);
      if (m.role === "assistant") {
        const wrap = chatEl.lastElementChild;
        if (wrap?.classList.contains("message-wrap")) {
          attachBookingButtonIfNeeded(wrap, m.content);
        }
      }
    }
  });
}

function renderWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.id = "welcome";
  welcome.innerHTML = `
<div class="welcome-icon">🔧</div>
<h2>故障诊断助手</h2>
<p>我是新能源汽车维修工程师，会用好懂的话帮您分析。先说说车辆情况；回答后如需更准确，可在下方点选温度、年限、快充等信息。</p>
<div class="topic-tags">
  <span>续航异常</span>
  <span>充电故障</span>
  <span>动力不足</span>
  <span>报警灯</span>
  <span>异响抖动</span>
  <span>热管理</span>
</div>
<div class="examples" id="examples"></div>
<p style="font-size:0.75rem;color:var(--muted);margin-top:0.75rem">首次使用请点击右上角「API 设置」配置 Base URL 与 API Key（OpenAI 兼容）</p>
  `;
  chatEl.appendChild(welcome);

  const examplesEl = welcome.querySelector("#examples");
  EXAMPLE_FORMS.forEach((ex, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "example-btn";
    btn.textContent = `示例 ${i + 1}：${ex.desc.slice(0, 22)}…`;
    btn.addEventListener("click", () => {
      fillForm(ex);
      formDesc.focus();
    });
    examplesEl.appendChild(btn);
  });
}

function removeWelcome() {
  document.getElementById("welcome")?.remove();
}

// [FIX-P1-03] 统一 message-wrap 包裹结构，Error 消息不再裸放
function appendMessage(role, content, extraClass = "", scenarioLabel = "") {
  const wrap = document.createElement("div");
  wrap.className = `message-wrap ${role}`;

  if (role === "user" || role === "assistant") {
    const label = document.createElement("span");
    label.className = "message-label";
    if (role === "user" && scenarioLabel) {
      label.textContent = `你 · 已识别：${scenarioLabel}`;
    } else {
      label.textContent = role === "user" ? "你" : "维修工程师";
    }

    const div = document.createElement("div");
    div.className = `message ${role} ${extraClass}`.trim();
    div.textContent = content;

    wrap.appendChild(label);
    wrap.appendChild(div);
    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  // [FIX-P1-03] Error 消息也用 message-wrap 包裹，保持结构一致
  const div = document.createElement("div");
  div.className = `message error ${extraClass}`.trim();
  div.textContent = content;
  wrap.appendChild(div);
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

function setLoading(on) {
  isLoading = on;
  setFormDisabled(on);
}

// [FIX-P1-03] 注入 Error message-wrap 居中对齐样式（补足 CSS 未定义的 .message-wrap.error 规则）
(function injectErrorWrapStyle() {
  const style = document.createElement("style");
  style.textContent = ".message-wrap.error { align-self: center; max-width: 100%; }";
  document.head.appendChild(style);
})();

async function sendMessage({ supplementMode = false } = {}) {
  if (isLoading) return;

  let data = getFormData();
  if (supplementMode && !data.description) {
    data = { ...data, description: getLastUserDescription() };
  }
  const err = validateForm(data, { supplementMode });
  if (err) {
    appendMessage("error", err);
    return;
  }

  saveSettings();
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim().replace(/\/$/, "");
  const model = modelInput.value.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    settingsPanel.classList.add("open");
    appendMessage("error", "请先在「API 设置」中填写 API Key。");
    return;
  }

  removeWelcome();

  const displayText = formatDisplayMessage(data, { supplementMode });
  const fullPrompt =
    buildFullPrompt(data, { supplementMode }) +
    "\n\n【知识库提示】请优先依据系统消息中的本地知识库条目回答；可引用 KB 编号。";
  const scenario = detectScenario(data.description);

  const userMsg = {
    role: "user",
    content: displayText,
    prompt: fullPrompt,
  };
  if (scenario) userMsg.scenario = scenario.id;
  messages.push(userMsg);
  appendMessage("user", displayText, "", scenario ? scenario.label : "");

  const loadingEl = appendMessage("assistant", "正在整理思路，马上回复您…", "loading");
  setLoading(true);

  try {
    const rawReply = await callOpenAIChatCompletions({
      baseUrl: apiBase,
      apiKey,
      model,
      messages: buildApiMessages(),
      temperature: 0.6,
    });

    // [FIX-P0-01] 已移除生产环境 console.log，调试可启用 window.__DEBUG__
    const reply = formatAIOutput(rawReply);

    messages.push({ role: "assistant", content: reply });
    loadingEl.innerHTML = enhanceAIOutput(reply);
    loadingEl.classList.remove("loading");
    attachBookingButtonIfNeeded(
      loadingEl.closest(".message-wrap"),
      rawReply
    );
    saveHistory();
    showSupplementPanel();
  } catch (err) {
    // [FIX-P1-02] 用户主动取消时跳过错误清理
    if (err.name === "AbortError") return;

    messages.pop();
    loadingEl.closest(".message-wrap")?.remove();
    const msg = err.message || String(err);
    appendMessage(
      "error",
      msg.includes("Failed to fetch")
        ? "网络或跨域错误：请检查 Base URL 是否正确，或在本机配置支持 CORS 的 API 代理。"
        : msg.includes("TimeoutError")
          ? "请求超时（30 秒未响应），请检查网络后重试。"
          : msg
    );
    if (messages.length === 0) renderWelcome();
  } finally {
    setLoading(false);
    formDesc.focus();
  }
}

diagForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage({ supplementMode: false });
});

supplementSubmitBtn.addEventListener("click", () => {
  sendMessage({ supplementMode: true });
});

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

// [FIX-P1-02] 清空话题时取消正在进行的请求
clearBtn.addEventListener("click", () => {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  clearHistory();
  resetForm();
  chatEl.innerHTML = "";
  renderWelcome();
  setLoading(false);
});

loadSettings();
loadHistory();
if (messages.length > 0) {
  renderChatFromHistory();
  if (messages[messages.length - 1]?.role === "assistant") {
    showSupplementPanel();
  }
} else {
  renderWelcome();
}
initSupplementChips();
updateHistoryHint();
formDesc.focus();
