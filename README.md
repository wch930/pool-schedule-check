# Downtown Toronto Lane Swim Tracker

实时追踪多伦多市中心三大室内游泳馆的 **Lane Swim** 开放状态、单日三馆对比时间轴、临时闭馆/设施通知与未来 4 周官方排期：

- **Wellesley Community Centre** (`id=451` · 495 Sherbourne St · Free Centre)
- **Pam McConnell Aquatic Centre** (`id=2012` · 640 Dundas St E · Free Centre)
- **St. Lawrence Community Recreation Centre** (`id=272` · 230 The Esplanade)

## 核心功能

- **一秒看谁在开**：基于多伦多当地时间 (`America/Toronto`) 自动计算哪个泳馆正在开放、还剩多久结束、即将开始倒计时，以及跨天下一场预告。
- **默认适配个人可游场次**：默认将通用 `Lane Swim` 与男士专场 `Lane Swim (Men)` 计入开放可游（并自动识别背靠背连场，例如 Wellesley 周四晚 `5:45 PM – 9:00 PM` 连游），同时支持一键切换 `仅通用`、`全部泳道 (含 Women / 60+)` 与 `全部泳池项目`。
- **三馆单日泳道时间轴 (06:00 – 22:00)**：直观对比早、中、晚三馆错峰时段，点击任意时间点即可预览该时刻哪家开放。
- **官网实时代理同步**：通过无依赖 Serverless 接口 (`/api/pools`) 并发拉取多伦多市政府官网实时排期 (`swim/week1..4.json`) 与设施维护预警 (`alerts.json`)，解决浏览器跨域限制。

## 本地运行

需要 Node.js 18+（零第三方依赖）：

```bash
npm run dev
```

服务默认监听端口 `3000`。运行单元测试：

```bash
npm test
```

## 部署指南（零配置）

仓库同时内置了 **Vercel** 与 **Cloudflare Pages** 的 Serverless 接口适配：

### 方式一：部署到 Vercel
1. 在 Vercel 导入本 GitHub 仓库 (`wch930/pool-schedule-check`)。
2. Framework Preset 保持默认 (`Other`)，仓库内置的 `vercel.json` 与 `api/pools.js` 会自动生效，直接点击 **Deploy** 即可。

### 方式二：部署到 Cloudflare Workers / Pages
1. **Cloudflare Workers (Workers Builds 自动部署)**：直接连接本仓库即可，内置的 `wrangler.toml` 与 `worker.js` 会自动托管 `public/` 静态资源并将 `/api/pools` 路由至边缘函数。
2. **Cloudflare Pages**：Build command 留空，Build output directory 填 `public`，根目录下的 `functions/api/pools.js` 会自动生效。
