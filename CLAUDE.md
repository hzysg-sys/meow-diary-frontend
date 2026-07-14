# Meow Diary — Frontend

## 项目背景

Meow Diary 是一个 AI 陪伴日记 App。"Meow"只是体现 App 整体可爱日记本氛围的命名，并不代表 AI 聊天对象是猫咪人设——AI 直接对接 Claude API，保持 Claude 本身的人格跟用户聊天，用户现在称呼它 "Elias"。本仓库是前端部分。

整体架构：
- 前端：React + Vite，部署到 Vercel（本仓库）
- 后端：Node.js + Express，部署到 Render（仓库 `meow-diary-backend`）
- 数据库：Supabase

## 技术栈

- React + Vite（JavaScript，未使用 TypeScript），主要在手机浏览器中使用（PWA，`public/sw.js`）
- 部署：Vercel，绑定 GitHub 仓库（`hzysg-sys/meow-diary-frontend`），push 到 `master` 自动部署
- 线上地址：https://meow-diary-frontend.vercel.app

## 代码结构

- `src/App.jsx` — 视图状态机：SPLASH / MAIN（底栏五个 tab）/ CHAT / PLACEHOLDER / MEMORY
- `src/api.js` — 所有后端请求；`apiFetch` 包装统一带 `Authorization: Bearer`（token 来自 `VITE_API_TOKEN`）
- `src/components/`
  - `ChatView.jsx` — 聊天：分页历史、发图（压缩后 base64）、编辑重发、重新生成、戳一戳、思考过程折叠、HTML artifact 预览
  - `ReadTab.jsx` — 阅读：epub（epub.js，含中文分词补丁和 CFI 定位修正）/ txt，划线、书签、背景色、与 Elias 讨论选段。文件较大，App.jsx 里做了 lazy 按需加载
  - `HealthTab.jsx` — 健康打卡日历、经期/排卵期预测
  - `Home.jsx` — 主页（恋爱天数 + 功能卡片入口）
  - `DiaryTab.jsx` — 日记：Elias 的心情随手记（后端 tick 自动写入），按天分组、上锁条目模糊占位；有新日记时 TabBar 上亮红点（对比 localStorage `diary-last-seen`）
- 主页“游戏”入口会在新窗口打开 Cedar Toy；AI 实际玩游戏的 MCP 调用由后端负责，前端不保存 Cedar token
- 未完成入口走 `PlaceholderView`

## 重要约定

- 环境变量：`.env.development` / `.env.production` 被 git 追踪，**不能放密钥**；token 放 `.env.development.local`（gitignored），线上在 Vercel 面板配 `VITE_API_TOKEN`，改完必须 Redeploy 才生效
- 后端直连请求一律走 `api.js` 的 `apiFetch`；Supabase Storage 的公开 URL（封面、书籍正文）用原生 `fetch`（带自家 token 会被拒）
- 消息列表用本地负数 id 做乐观更新，落库后的操作（编辑/重新生成）必须检查 `id > 0`
- ChatView 常驻挂载靠 class 显隐，滚动定位要等 `active` 为 true 才生效（见组件内注释）

## 当前状态（2026-07）

聊天、健康（打卡+经期预测）、阅读（epub/txt + 划线书签讨论）、记忆文档全部完成并上线。主页的 token / 朋友圈 / 信箱三个卡片还是占位页。
