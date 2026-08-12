# BOSS AI 助手（桌面版）

基于 Electron 的企业级求职辅助桌面应用：多智能体系统 + 现代化面板，内置 BOSS 直聘浏览环境。

## 功能

- **多智能体系统**（Supervisor 编排，`src/orchestrator.js`）
  - 招呼语 Agent：JD↔简历相关性工程化筛选，只引用高相关素材，历史防雷同
  - 回复 Agent：贴合对话语境，素材全部来自真实简历
  - 求职信 Agent：基于真实经历论证，杜绝编造与套话
  - 面试教练 Agent：联网检索公司情报 + 简历，生成结构化面试准备卡
  - 尽调分析师 Agent：百度/搜狗/Bing 三引擎并行采集，输出企业尽调报告
- **小红书舆情采集**：内置打开小红书 AI 搜索，用户站内检索后粘贴结果作为尽调证据
- **职位筛选**：本地实时过滤（薪资/关键词/公司黑名单）
- **现代化 UI**：深色/浅色主题、智能体活动流、尽调进度条

## 开发

```bash
cd desktop
npm install
npm start          # 开发运行（可加 --remote-debugging-port=9333 调试）
npm run build      # 打包 → dist/BOSSAI助手.exe（portable）
```

## 目录结构

```
desktop/
  main.js              主进程：窗口/双视图(BOSS+面板)/注入
  preload-boss.js      BOSS 页桥（chrome.* → IPC）
  preload-panel.js     面板 API 暴露
  panel.{html,css,js}  面板 UI
  content/content.js   注入 BOSS：JD抓取/聊天监听/筛选/悬浮组件
  src/
    core/              logger/store/llm(网关)/tools(多引擎采集)
    agents/            5 个专业智能体（base 基类）
    registry.js        Agent 注册表
    orchestrator.js    Supervisor 编排/并发锁/事件流
    ipc.js             IPC 路由（存储/智能体/筛选/小红书/窗口）
```

## 数据说明

- API Key 仅存本机 `%APPDATA%/boss-ai-desktop/settings.json`
- 公开信息采集仅通过搜索引擎公开结果，不破解任何登录/反爬
- 小红书需用户自行扫码登录、自行粘贴内容，系统只做只读提取

## 隐私与安全

- **所有个人数据（API Key、简历、登录态）只存在本机** `%APPDATA%/boss-ai-desktop/`，不在代码仓库内，开源不泄露任何个人信息
- 源码中不包含任何真实用户数据（简历、账号均为占位符）
- 发送消息始终由用户手动确认，系统只负责生成与填入输入框
- 请勿将 `settings.json` 或本机数据目录提交到任何仓库

## 开源

本仓库为开源项目，欢迎提交 Issue 与 PR。构建与使用方式见上文「开发」与「数据说明」。

