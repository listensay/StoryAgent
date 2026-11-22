# StoryAgent

StoryAgent 是以小说项目为中心的 Agent 创作桌面工具，面向长篇连载与短篇创作，覆盖选题研究、创作准备、故事规划、正文写作、审稿与续写。作者可以管理小说设定、连接多个 AI 服务，提炼、训练并使用小说 Skill。

## 功能

| 功能 | 内容 |
| --- | --- |
| 小说项目 | 填写题材和小说想法，由 AI 生成核心设定及包含人物、分卷的总纲方案；支持选择方案、聊天修改、重新生成与草稿恢复。 |
| 小说 AI | 统一对话调整小说信息、总纲、卷纲、人物关系、世界设定与章节计划，支持导入新总纲、按总纲同步、整套预览、一次采用与撤销。内置项目操作 Skill。 |
| 创作准备 | 管理小说信息、人物与世界设定，使用人物关系图编辑关系、拖动节点与自动布局，选择参考资料和创作 Skill，通过小说 AI 统一补全或调整简介、设定与总纲。 |
| 故事规划 | 编写总纲、卷纲、章节与场景计划，管理情节分支，支持边写边补充设定与大纲。 |
| 正文编辑 | 章节增删、排序、复制、自动保存，正文与细纲编辑，局部改写、版本对比与恢复。 |
| Agent 写作 | 通过聊天记录查看任务分析、Skill 调用与生成过程，完成后跳转至生成稿；起草依次生成细纲、正文、摘要与记忆，支持续写、改写、审稿、章节范围、停止与恢复，由作者确认正文修订。 |
| 小说记忆 | 自动生成并更新章节摘要、正文事实、人物状态、时间线、伏笔与知情状态。 |
| 多 AI 接入 | 配置多个供应商的 API 地址和密钥，适配 OpenAI 兼容接口、OpenAI Responses、Anthropic 与 Gemini；获取并多选模型，支持手动添加模型 ID。 |
| 模型与推理设置 | 供应商、模型及推理方式自动保存；每个供应商可设置 AI 并发数量，并管理输出、上下文、采样及附加参数。 |
| 网络代理 | 自动检测系统与环境代理，支持手动配置 HTTP、HTTPS、SOCKS 代理或关闭代理；AI、采集与软件更新统一使用代理设置，本机网关直接连接。 |
| 小说封面 | 上传封面或通过 OpenAI 兼容图片接口生成封面，支持多个图片供应商、获取和多选模型；生成时设置尺寸与画质，通过对话调整封面、预览版本并应用。 |
| 小说 Skill | 内置创作、规划、审稿、扫榜、拆文与提炼 Skill；从公开 GitHub 仓库或子目录、`SKILL.md`、文件夹或 ZIP 导入，管理资源、适用任务、启停与版本。 |
| 扫榜与选题 | 自动采集起点中文网、番茄小说的公开榜单，展示作品封面、名次、简介和公开指标；选择作品后自动读取目录、获取可读章节并缓存，供拆文与Skill 提取使用。受限或无法识别的章节显示获取状态。 |
| 书籍搜索 | 按书名或作者搜索全部采集站，按来源选择书籍、下载开篇或指定章节，进行拆文与Skill 提取；支持搜索分页、停止、重试与正文缓存。 |
| 文章采集 | 在设置中管理采集规则，预置 69书吧、爱下电子书的搜索、目录与正文规则，支持目录章节范围、单章采集及自动保存为参考资料。 |
| 拆文分析 | 分析开篇、章节或全文中的人物、结构、节奏、伏笔与写作手法，长文本分段分析与逐层综合，通过段落引用定位原文。 |
| Skill 训练营 | 提炼原文章节内容与创作提示词，使用 Skill 生成正文并与原文对照；由用户评分和划词反馈，按反馈调整 Skill，保留最佳版本；确认效果满意后可进行其他场景训练。 |
| 全局任务 | 悬停 Logo 查看 AI 与正文采集任务，跨页面持续执行，点击返回对应页面，支持停止、恢复与失败重试。 |
| 软件更新 | 自动检查 GitHub Release，右上角显示更新入口与下载进度；点击后校验签名，等待任务结束，保存工作区并安装、重启。 |
| 导入与导出 | 导入 TXT、Markdown 小说，导出正文；通过 JSON 备份和恢复整个工作区。 |

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

在仓库的 Actions Secrets 中配置 `TAURI_SIGNING_PRIVATE_KEY`，内容为与 `tauri.conf.json` 公钥对应的 Tauri 签名私钥；加密私钥同时配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。私钥应保存在仓库外，并保留安全备份。首次配置签名身份可使用 `npm run tauri signer generate -- -w ~/.tauri/storyagent.key`，将生成的公钥内容填写到 `plugins.updater.pubkey`。

本地 `npm run build` 默认使用 `~/.tauri/storyagent.key` 签名，也可通过 `TAURI_SIGNING_PRIVATE_KEY` 指定其他私钥路径或内容。私钥加密时设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。GitHub Actions 使用仓库 Secrets，不读取本地私钥。客户端从 [GitHub Releases](https://github.com/listensay/StoryAgent/releases) 获取适合当前系统和架构的更新。

## 相关入口

- [Tauri 开发文档](https://v2.tauri.app/develop/)
- [React 文档](https://react.dev/)
- [Mantine 文档](https://mantine.dev/)
- [Hugeicons React 文档](https://hugeicons.com/docs/integrations/react)
- [Vite 文档](https://vite.dev/)
