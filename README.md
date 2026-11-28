# StoryAgent

StoryAgent 是以小说项目为中心的 Agent 创作桌面工具，面向长篇连载与短篇创作，覆盖选题研究、创作准备、故事规划、正文写作、审稿与续写。作者可以管理小说设定、连接多个 AI 服务，提炼、训练并使用小说 Skill。

## 功能

| 功能 | 内容 |
| --- | --- |
| 桌面窗口 | 打开时铺满当前显示器的工作区域，窗口大小固定；macOS 支持原生全屏。章节目录保留操作菜单，可编辑文本保留系统右键菜单。 |
| 小说项目 | 填写题材和小说想法，由 AI 生成核心设定及包含人物、分卷的总纲方案；支持选择方案、聊天修改、重新生成与草稿恢复。 |
| 小说 AI | 统一对话调整小说信息、总纲、卷纲、人物关系、世界设定与章节计划，支持导入新总纲、按总纲同步、更新前后对比、一次采用与撤销。内置项目操作 Skill。 |
| 创作准备 | 管理小说信息、参考资料与创作 Skill，上传或生成小说封面。 |
| 人物档案 | 按基础身份、外貌、性格、动机、语言、行为、能力、经历、关系、立场、成长与剧情功能编辑完整人物档案；支持人物关系图、拖动节点与自动布局。 |
| 世界设定 | 独立管理世界背景、规则与设定记录，通过小说 AI 统一补全或调整。 |
| 故事规划 | 编写总纲、卷纲、章节与场景计划，管理情节分支，支持边写边补充设定与大纲。 |
| 正文编辑 | 正文常驻，可收起侧栏；边写边查看本章人物、设定、细纲与版本。重新打开小说恢复章节和阅读位置。支持章节排序、划词润色、局部改写与版本恢复。 |
| Agent 写作 | 按章节查看或清空创作任务的聊天记录，清空后保留生成稿和进行中的任务；可查看任务分析、Skill 调用与生成过程。创作任务只针对当前章节，可起草、续写、改写、审稿或生成细纲。起草依次生成细纲、正文、摘要与记忆，支持停止与恢复，生成稿可逐段编辑、预览和采用。 |
| 小说记忆 | 保存或采用正文后提取章节摘要、事实、人物状态、时间线、伏笔与知情状态。沿跨章引文查看修改影响、伏笔回收和人物轨迹，由作者对照原文判断疑点。 |
| 审稿修订 | 按事实矛盾与表达建议定位原文，逐项修改、忽略或稍后处理；可对照修改结果，复查并确认解决。 |
| 全书搜索 | 查找正文、人物、设定和大纲，定位匹配内容，预览并确认批量替换；正文保留替换前版本。 |
| 多 AI 接入 | 配置多个供应商的 API 地址和密钥，适配 OpenAI 兼容接口、OpenAI Responses、Anthropic 与 Gemini；获取并多选模型，支持手动添加模型 ID。 |
| 模型与推理强度 | 创作任务可在发送前直接选择推理强度和模型，模型按供应商分组，所选配置自动保存；每个供应商可设置 AI 并发数量，并管理输出、上下文、采样及附加参数。 |
| 网络代理 | 自动检测系统与环境代理，支持手动配置 HTTP、HTTPS、SOCKS 代理或关闭代理；AI、采集与软件更新统一使用代理设置，本机网关直接连接。 |
| 小说封面 | 上传封面或通过 OpenAI 兼容图片接口生成封面，支持多个图片供应商、获取和多选模型；生成时设置尺寸与画质，通过对话调整封面、预览版本并应用。 |
| 小说 Skill | 在「资源库 → 技能管理 → 新建 Skill」填写用途和写作规则，选择适用任务；也可使用内置 Skill，或从公开 GitHub 仓库或子目录、`SKILL.md`、文件夹或 ZIP 导入，管理资源、适用任务、启停与版本。可从日常修稿差异提炼规则，确认后保存为新版本，并为每部小说固定所用版本。 |
| 扫榜与选题 | 自动采集起点中文网、番茄小说的公开榜单，展示作品封面、名次、简介和公开指标；选择作品后自动读取目录、获取可读章节并缓存，供拆文与Skill 提取使用。受限或无法识别的章节显示获取状态。 |
| 书籍搜索 | 按书名或作者搜索全部采集站，按来源选择书籍、下载开篇或指定章节，进行拆文与Skill 提取；支持搜索分页、停止、重试与正文缓存。 |
| 文章采集 | 在设置中管理采集规则，预置 69书吧、爱下电子书的搜索、目录与正文规则，支持目录章节范围、单章采集及自动保存为参考资料。 |
| 拆文分析 | 分析开篇、章节或全文中的人物、结构、节奏、伏笔与写作手法，长文本分段分析与逐层综合，通过段落引用定位原文。 |
| Skill 训练营 | 从列表选择提炼或导入的 Skill，进入对应页面选择训练方式；提炼原文章节内容与创作提示词，使用 Skill 生成正文并与原文对照；支持 AI 对比提出 Skill 规则调整、手写反馈、片段评价与可选评分，按反馈调整 Skill，查看各轮 Skill 改动并保留最佳版本；确认效果满意后可进行其他场景训练。 |
| 全局任务 | 悬停 Logo 查看 AI 与正文采集任务，跨页面持续执行，点击返回对应页面，支持停止、恢复与失败重试。 |
| 软件更新 | 启动、返回窗口、恢复联网及使用期间自动检查 GitHub Release，发现新版本时主动提示并高亮右上角更新入口；确认安装后校验签名、等待任务结束并保存工作区后重启。 |
| 导入与导出 | 导入 TXT、Markdown 小说，导出正文；通过 JSON 备份和恢复整个工作区。自动备份在保存时按小时间隔创建，保留最近 14 份；误删的小说或章节可从「我的小说 → 回收站」恢复。 |

## 技术栈

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| Tauri | 2 | 桌面应用运行、打包与原生能力调用。 |
| React | 19 | 前端界面与交互。 |
| Mantine | 9 | 组件、弹窗、通知与统一主题定制。 |
| Hugeicons | 免费图标 | 通过 `@hugeicons/react` 渲染 `@hugeicons/core-free-icons` 图标。 |
| React Flow / Dagre | 13 / 3 | 人物关系图交互与自动布局。 |
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

## 发布与更新

GitHub Actions 在推送 `v*` 版本标签时构建 macOS（Apple Silicon、Intel）、Windows x64 安装包和 Linux x64 AppImage，以及对应的签名更新包。版本标签须与 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本一致。所有平台构建成功后，工作流生成 `latest.json` 并发布 Release；预发布版本不进入稳定更新入口。

将 App 改动提交到 `main` 后，在干净工作区执行 `npm run release`。命令默认递增修订版本，同步版本与锁文件，运行检查，提交并推送版本标签，等待 GitHub 发布完成。发布需要已登录的 [GitHub CLI](https://cli.github.com/) 和仓库签名密钥；可用 `npm run release -- 0.2.0` 指定版本，或用 `npm run release -- --dry-run` 查看计划。

每个发布版本需在 [更新记录](CHANGELOG.md) 中填写简短的功能改进与修复；GitHub Release 与 App 更新弹窗使用相同记录。

在仓库的 Actions Secrets 中配置 `TAURI_SIGNING_PRIVATE_KEY`，内容为与 `tauri.conf.json` 公钥对应的 Tauri 签名私钥；加密私钥同时配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。私钥应保存在仓库外，并保留安全备份。首次配置签名身份可使用 `npm run tauri signer generate -- -w ~/.tauri/storyagent.key`，将生成的公钥内容填写到 `plugins.updater.pubkey`。

本地 `npm run build` 默认使用 `~/.tauri/storyagent.key` 签名，也可通过 `TAURI_SIGNING_PRIVATE_KEY` 指定其他私钥路径或内容。私钥加密时设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。GitHub Actions 使用仓库 Secrets，不读取本地私钥。客户端从 [GitHub Releases](https://github.com/listensay/StoryAgent/releases) 获取适合当前系统和架构的更新。

## 相关入口

- [Tauri 开发文档](https://v2.tauri.app/develop/)
- [React 文档](https://react.dev/)
- [Mantine 文档](https://mantine.dev/)
- [Hugeicons React 文档](https://hugeicons.com/docs/integrations/react)
- [Vite 文档](https://vite.dev/)
