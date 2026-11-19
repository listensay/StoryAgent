# StoryAgent

StoryAgent 是以小说项目为中心的 Agent 创作桌面工具，面向长篇连载与短篇创作，覆盖选题研究、创作准备、故事规划、正文写作、审稿与续写。作者可以管理小说设定、连接多个 AI 服务、导入小说 Skill，并在写作时选择表达风格。

## 功能

| 功能 | 内容 |
| --- | --- |
| 小说项目 | 管理长篇与短篇、题材、主题、读者定位与篇幅目标，维护人物、人物关系和世界设定。 |
| 故事规划 | 编写总纲、卷纲、章节与场景计划，管理情节分支，支持边写边补充设定与大纲。 |
| 正文编辑 | 章节增删、排序、复制、自动保存，正文与细纲编辑，局部改写、版本对比与恢复。 |
| Agent 写作 | 起草、续写、改写与审稿；指定章节范围、连续生成、停止与恢复，由作者确认正文修订。 |
| 小说记忆 | 记录正文事实、人物状态、章节摘要、时间线、伏笔与角色知情状态，区分已确认正文、后续计划和外部参考。 |
| 多 AI 接入 | 配置多个服务的 API 地址和密钥，适配 OpenAI 兼容接口、OpenAI Responses、Anthropic 与 Gemini；从服务接口获取模型列表，并支持手动填写模型 ID。 |
| 模型与推理设置 | 按模型能力设置推理模式、推理强度、推理预算、采样与输出参数，为规划、写作和审稿等任务保存模型预设。 |
| 小说 Skill | 内置创作、规划、审稿、扫榜、拆文与风格 Skill；从公开 GitHub 仓库或子目录、`SKILL.md`、文件夹或 ZIP 导入，管理资源、适用任务、启停与版本。 |
| 扫榜与选题 | 自动采集起点中文网、番茄小说的公开榜单，展示作品封面、名次、简介和公开指标；保存采集记录、生成选题候选，并关联作品正文进行拆文与风格提取。 |
| 拆文分析 | 分析开篇、章节或全文中的人物、结构、节奏、伏笔与写作手法，长文本分段分析与逐层综合，通过段落引用定位原文。 |
| 写法与风格 | 从参考文本或作者正文提取可编辑的风格配置，支持项目默认风格，以及章节写作、续写和局部改写时单独选择。 |
| 导入与导出 | 导入 TXT、Markdown 小说，导出正文；通过 JSON 备份和恢复整个工作区。 |

## 技术栈

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| Tauri | 2 | 桌面应用运行、打包与原生能力调用。 |
| React | 19 | 前端界面与交互。 |
| Mantine | 9 | 组件、弹窗、通知与统一主题定制。 |
| Hugeicons | 免费图标 | 通过 `@hugeicons/react` 渲染 `@hugeicons/core-free-icons` 图标。 |
| TypeScript | 6 | 前端类型检查。 |
| Vite | 8 | 前端开发服务与构建。 |
| Rust | 2024 Edition | 桌面端逻辑与 Tauri 命令。 |
| SQLite | — | 小说项目与工作区保存。 |
| reqwest / Keyring | — | 桌面端 HTTP、流式生成与系统凭据管理。 |
| Zod / YAML / fflate | — | 数据校验、Skill 元数据与 ZIP 导入。 |

## 环境要求

- Node.js 22.12 或更新版本，建议使用受支持的 LTS 版本；npm 用于安装前端依赖。
- Rust 稳定版与 Cargo，需支持 Rust 2024 Edition。
- 对应平台的 Tauri 开发依赖：macOS 需要 Xcode Command Line Tools，Windows 需要 Microsoft C++ Build Tools 与 WebView2，Linux 需要 WebKitGTK 等系统库。完整要求见 [Tauri 环境准备](https://v2.tauri.app/start/prerequisites/)。

## 安装

获取项目源码后，在项目根目录安装前端依赖：

```sh
npm ci
```

Rust 依赖由 Cargo 在首次启动或构建桌面应用时获取。

## 快速开始

启动桌面开发应用：

```sh
npm run dev
```

该命令会同时启动 Vite 开发服务与 Tauri 桌面应用。

## 构建

构建桌面应用与安装包：

```sh
npm run build
```

默认构建产物位于 `src-tauri/target/release/`，安装包位于其 `bundle/` 目录。

检查 TypeScript 并构建 App 界面资源：

```sh
npm run ui:build
```

界面资源位于 `dist/`，由 Tauri 打包到桌面应用中。

## 相关入口

- [Tauri 开发文档](https://v2.tauri.app/develop/)
- [React 文档](https://react.dev/)
- [Mantine 文档](https://mantine.dev/)
- [Hugeicons React 文档](https://hugeicons.com/docs/integrations/react)
- [Vite 文档](https://vite.dev/)
