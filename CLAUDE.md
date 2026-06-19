# Meow Diary — Frontend

## 项目背景

Meow Diary 是一个 AI 陪伴日记 App。用户写日记，AI 以"猫咪"的人设陪伴、回应、记录心情。本仓库是前端部分。

整体架构：
- 前端：React + Vite，部署到 Vercel（本仓库）
- 后端：Node.js + Express，部署到 Render（仓库 `meow-diary-backend`）
- 数据库：Supabase

## 技术栈

- React + Vite（JavaScript，未使用 TypeScript）
- 部署：Vercel，绑定本 GitHub 仓库（`hzysg-sys/meow-diary-frontend`），push 到 `master` 自动触发部署

## 当前进度

**第四章「部署骨架」已完成并验证通过。**

- 本地：`npm install` + `npm run dev` 可正常跑起 Vite 默认页面
- 线上地址：https://meow-diary-frontend.vercel.app （已验证返回 200，页面结构正常）
- 目前只有 Vite 脚手架生成的默认页面，没有任何业务功能、没有接后端、没有接 Supabase

## 下一步计划

**第五章：Supabase 建表**，搭建数据库表结构（日记条目、用户等），后续章节再接入实际的日记 UI 和与后端的联调。
