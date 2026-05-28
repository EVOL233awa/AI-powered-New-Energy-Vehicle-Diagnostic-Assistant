# AI-powered-New-Energy-Vehicle-Diagnostic-Assistant
AI-powered New Energy Vehicle Diagnostic Assistant with multi-turn interaction, knowledge base reasoning, and structured fault analysis.
# 基于多轮交互的新能源汽车AI智能诊断系统

> AI-powered New Energy Vehicle Diagnostic Assistant

一个面向新能源汽车车主的 AI 故障预诊断系统，通过多轮交互收集车辆信息，结合本地知识库、规则引擎与大语言模型（LLM），为用户提供结构化故障分析、原因推断与排查建议。

---

## 项目简介

新能源汽车用户在遇到续航下降、充电异常、动力不足、报警灯亮起等问题时，往往难以快速判断故障原因。

本项目通过 AI 多轮交互方式，引导用户逐步补充车辆信息，并结合行业知识库与诊断规则，生成通俗易懂的分析结果，帮助用户在前往维修站前完成初步故障判断。

---

## 核心功能

### 智能故障诊断

用户输入故障描述后，系统自动分析车辆状态并生成诊断结果。

支持：

* 续航异常
* 充电故障
* 动力不足
* 仪表报警
* 异响抖动
* 热管理问题
* 无法启动
* 空调异常

---

### 多轮交互式诊断

支持在初次分析后继续补充：

* 环境温度
* 车辆使用年限
* 快充使用频率

系统根据新增信息动态更新诊断结果，提高分析准确性。

---

### 本地知识库增强

内置新能源汽车常见故障知识库，包括：

* 冬季续航下降
* 电池衰减
* 慢充异常
* BMS报警
* 充电功率受限
* 电机过热
* 12V蓄电池亏电
* 能量回收异常
* 高压互锁故障
* 增程系统异常

等典型场景。

---

### 场景识别引擎

自动识别用户描述中的故障类型：

* Charging（充电系统）
* Range（续航问题）
* Power（动力系统）
* Alarm（故障报警）
* Overheat（热管理）
* Noise（异响振动）
* HV Start（启动异常）
* Air Conditioning（空调系统）

并自动注入针对性诊断策略。

---

### 结构化输出

系统强制输出标准三段式结果：

【初步判断】

【可能原因】

【建议】

同时自动标注风险等级：

🟢 偏轻微

🟡 建议检查

🔴 建议尽快检测

提高普通用户的阅读效率。

---

### 预约检修引导

当系统判断故障需要进一步检测时，将自动提供预约检修入口，引导用户联系专业维修机构。

---

## 技术架构

Frontend

* HTML5
* CSS3
* Vanilla JavaScript

AI Layer

* OpenAI Compatible API
* DeepSeek API
* GPT 系列模型
* 兼容其他 OpenAI 格式接口

Knowledge Layer

* 本地知识库
* 规则引擎
* 场景识别系统

Storage

* LocalStorage
* 会话历史记录
* API配置持久化

---

## 项目特色

* 多轮交互式故障诊断
* AI + 本地知识库混合架构
* 规则引擎增强推理
* OpenAI兼容接口设计
* 支持自定义API接入
* 轻量化纯前端部署
* GitHub Pages可直接上线

---

## 项目截图

<img width="2546" height="1391" alt="image" src="https://github.com/user-attachments/assets/b164b735-386f-4050-80be-3ab8e7c701d9" />


---

## 在线体验

GitHub Pages：

https://evol233awa.github.io/AI-powered-New-Energy-Vehicle-Diagnostic-Assistant/

```text
待部署
```

---

## 使用方法

### 1. 配置 API

填写：

* API Key
* Base URL
* Model Name

支持：

* DeepSeek
* OpenAI
* OpenRouter
* 其他 OpenAI Compatible API

---

### 2. 输入故障描述

示例：

```text
电池续航最近下降明显，天气变冷后更严重，没有报警灯。
```

---

### 3. 获取诊断结果

系统自动返回：

* 初步判断
* 可能原因
* 排查建议

并支持继续补充信息进行二次分析。

---

## 未来规划

* 接入向量知识库（RAG）
* 故障码（DTC）识别
* 维修案例库
* 云端用户系统
* 维修站预约系统
* 微信小程序版本
* Agent化诊断流程

---

## 作者

EVOL233awa

聚焦方向：

* AI Agent
* 新能源汽车
* 智能诊断系统
* AI应用开发

---

## License

MIT License
