# 🌐 DNS Panel

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://hub.docker.com/r/a3180623/dns-panel)

> 现代化的多 DNS 服务商统一管理面板：多用户、多凭证隔离，统一管理域名与 DNS 解析记录，支持 Cloudflare Tunnels 管理，并提供操作日志审计。

---

## 📑 目录

- [功能概览](#-功能概览)
- [Cloudflare Tunnels](#-cloudflare-tunnels)
- [支持的服务商](#-支持的服务商)
- [技术栈](#-技术栈)
- [快速部署](#-快速部署docker-compose)
- [Docker Hub 镜像](#-docker-hub-镜像部署)
- [首次使用](#-首次使用)
- [本地开发](#-本地开发)
- [环境变量](#️-环境变量)
- [常见问题](#-常见问题)
- [版本更新](#-版本更新)

---

## 📋 版本更新

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.5.0 | 2026-03-02 | 🆕 新增 Cloudflare Tunnels 管理：隧道创建/删除、详情面板、cloudflared 安装指引、三类路由管理（Public Hostnames / CIDR / 主机名路由） |
| v1.4.1 | 2026-02-18 | ✨ 抽屉支持 DNS 服务商拖拽排序 + 前端体验优化 |
| v1.4.0 | 2026-02-18 | ✨ 新增阿里云 ESA 站点管理与免费证书 |
| v1.3.0 | 2026-01-30 | ✨ 多服务商添加/删除域名功能 |
| v1.2.0 | 2026-01-30 | ✨ 新增 Cloudflare 添加域名功能 |
| v1.1.0 | 2026-01-29 | ✨ 新增火山引擎、京东云、DNSLA 支持 |
| v1.0.0 | 2026-01-15 | 🎉 首次发布 |

<details>
<summary><b>查看完整更新日志</b></summary>

### v1.5.0 (2026-03-02)
- 🆕 **新增 Cloudflare Tunnels 管理**
  - 隧道列表：创建 / 删除 Tunnel，查看连接状态，支持搜索过滤
  - 删除 Tunnel 时可选同时清理指向该 Tunnel 的 DNS CNAME 记录
- ✨ **隧道详情面板**（展开即可查看）
  - Active Replicas 表格：Replica ID / Origin IP / Edge Locations / Version / Architecture / Uptime
  - Routes 概览：从 Tunnel Config 解析 ingress 公开路由列表
  - Status / Uptime 统计卡片
- ✨ **未连接安装指引**（Tunnel 状态为 inactive/down 时自动展示）
  - 支持 5 个平台切换：Windows / macOS / Debian / Red Hat / Docker
  - 自动生成安装命令和 `cloudflared tunnel run --token <TOKEN>` 连接命令
  - Token 默认遮罩显示，复制时保留完整值
- ✨ **路由管理弹窗（三类 Tab）**
  - 已发布应用程序路由（Public Hostnames）：增删改 ingress 规则，自动同步 DNS CNAME，失败时自动回滚 Tunnel 配置
  - CIDR 路由：创建 / 查询 / 删除私网 CIDR 路由（IPv4/IPv6），含前端格式校验
  - 主机名路由：创建 / 查询 / 删除私网主机名路由，含通配符支持
- 🔧 **后端 Tunnel API**
  - 新增 12+ 个 REST 端点：Tunnel CRUD、Config、Token、Public Hostnames、CIDR 路由、主机名路由
  - 私网路由聚合查询使用 `Promise.allSettled`，部分失败仍可返回
  - 删除路由前增加归属校验，防止跨 Tunnel 误删

### v1.4.1 (2026-02-18)
- ✨ 左侧抽屉：DNS 服务商支持拖拽排序（长按拖动，顺序自动保存）
- 💄 前端体验优化
  - 「DNS 账户管理」新增/编辑对话框样式统一，移动端不再全屏
  - 优化表单自动填充干扰（别名/Token 更不易被误识别为账号密码）
  - 优化抽屉交互：移除移动端点击蓝色遮罩、退出登录菜单居中、修复腾讯云重复显示

### v1.4.0 (2026-02-18)
- ✨ 新增阿里云 ESA（边缘安全加速）站点管理
  - 账号级「DNS 域名」与「ESA 站点管理」一键切换
  - 支持多 Region 拉取站点/实例（cn-hangzhou / ap-southeast-1）
  - 新增站点创建：接入方式（CNAME/NS）、覆盖范围、套餐实例（含配额展示）
- ✨ 新增 ESA DNS 记录管理
  - 记录增删改查、CNAME 配置指引与状态检测
  - HTTPS 证书状态展示 + 一键申请/续签免费证书（Let's Encrypt；基础版/更高支持 DigiCert）
  - 提供托管 DCV / DCV 验证信息复制，支持外部 DNS 场景
- 🐛 修复若干前端交互问题（站点下拉白屏、编辑凭证回填 label 重叠等）
- 🔧 新增后端 ESA API 路由与签名适配（增强错误信息、兼容 POST/GET）

### v1.3.0 (2026-01-30)
- ✨ 新增多服务商添加/删除域名功能
  - 支持：Cloudflare、阿里云、腾讯云（DNSPod）、华为云、百度云、火山引擎、京东云、DNSLA、PowerDNS
- 🔧 统一域名管理接口，支持批量添加、自动去重

### v1.2.0 (2026-01-30)
- ✨ 新增 Cloudflare 添加域名功能（批量添加、自动去重）
- ✨ 添加结果展示 NS 服务器信息，支持一键复制
- 🔒 删除域名增加二次确认（需输入域名）
- 💄 优化添加域名对话框 UI

### v1.1.0 (2026-01-29)
- ✨ 新增火山引擎 DNS 支持
- ✨ 新增京东云 DNS 支持
- ✨ 新增 DNSLA 支持
- 🐛 修复 Cloudflare 自定义主机名显示问题

### v1.0.0 (2026-01-15)
- 🎉 首次发布
- 支持 Cloudflare、阿里云、DNSPod、华为云、百度云、西部数码、NameSilo、PowerDNS、Spaceship

</details>

---

## ✨ 功能概览

| 功能 | 说明 |
|------|------|
| 🌐 多服务商支持 | 统一管理多个 DNS 服务商的域名和解析记录 |
| 🧾 解析记录管理 | 增删改查；支持权重/线路/启停/备注等 |
| ☁️ Cloudflare 增强 | 自定义主机名、证书状态、Fallback Origin |
| 🚇 Cloudflare Tunnels | 隧道管理、路由配置（公网主机名 / CIDR / 主机名路由） |
| 🛡️ 阿里云 ESA | 边缘安全加速站点管理、DNS 记录、免费证书申请/续签 |
| 🔑 多用户隔离 | JWT 登录、账户与凭证隔离 |
| 🔒 安全存储 | DNS 凭证加密存储（AES-256） |
| 💾 数据持久化 | SQLite 数据库，挂载 Volume 即可备份迁移 |

### 🚇 Cloudflare Tunnels

通过面板即可完成 Cloudflare Tunnel 的全生命周期管理，无需手动操作 `cloudflared` 配置文件。

| 能力 | 说明 |
|------|------|
| 隧道管理 | 创建 / 删除 Tunnel，查看连接状态与副本（Replica）信息 |
| 详情面板 | 展开查看 Active Replicas、Routes、Uptime 等运行指标 |
| 安装指引 | 未连接 Tunnel 自动展示 cloudflared 安装 / 启动命令（Windows / macOS / Debian / Red Hat / Docker） |
| Token 安全 | Token 默认遮罩显示，复制时保留完整值 |
| 已发布应用程序路由 | 管理 Public Hostnames（ingress），自动同步创建 / 更新 DNS CNAME 记录，失败时自动回滚 |
| CIDR 路由 | 创建 / 查询 / 删除私网 CIDR 路由，支持归属校验防止跨 Tunnel 误删 |
| 主机名路由 | 创建 / 查询 / 删除私网主机名路由 |
| DNS 清理 | 删除 Tunnel 时可选同时清理指向该 Tunnel 的 DNS CNAME 记录 |

> ⚠️ Tunnels 功能需要 Cloudflare API Token 具备 **Account: Cloudflare Tunnel（编辑）** 和 **Zone: DNS（编辑）** 权限。

---

## 🏢 支持的服务商

| 国内服务商 | 国际服务商 |
|-----------|-----------|
| 阿里云 | Cloudflare |
| DNSPod（腾讯云） | NameSilo |
| 华为云 | PowerDNS |
| 百度云 | Spaceship |
| 西部数码 | |
| 火山引擎 | |
| 京东云 | |
| DNSLA | |

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + Vite + MUI + TanStack Query |
| 后端 | Node.js 18 + Express + TypeScript + Prisma |
| 数据库 | SQLite（默认） |

---

## 🚀 快速部署（Docker Compose）

> 推荐方式：前后端一体，只需暴露一个端口。

## 🏷️ 发版（Tag 自动发布）

项目已提供 GitHub Actions 工作流：当推送 `v*` Tag（例如 `v1.5.0`）时，会自动：

- 构建并推送 Docker 镜像：`a3180623/dns-panel:<tag>`、`a3180623/dns-panel:<version>`、`a3180623/dns-panel:latest`
- 创建 GitHub Release（自动生成 Release Notes）

使用方法：

```bash
git tag v1.5.0
git push origin v1.5.0
```

发布前请在 GitHub 仓库 Secrets 中配置：

- `DOCKER_USERNAME`
- `DOCKER_PASSWORD`

### 前置条件

- Linux 服务器（Ubuntu / Debian 等）
- 已安装 Git、Docker 与 Docker Compose v2
- 开放端口 `3000`（或通过反代访问）

### 1️⃣ 克隆仓库

```bash
git clone https://github.com/Frankieli123/dns-panel.git
cd dns-panel
```

### 2️⃣ 配置环境变量

在仓库根目录创建 `.env` 文件：

```env
# 必填：生产环境必须设置强随机值
JWT_SECRET=your-random-jwt-secret-min-32-chars-here
ENCRYPTION_KEY=your-32-character-encryption-key!!

# 可选：跨域访问时设置
# CORS_ORIGIN=https://panel.example.com
```

**生成安全密钥：**

```bash
openssl rand -base64 48  # JWT_SECRET（建议 32+ 字符）
openssl rand -hex 16     # ENCRYPTION_KEY（必须 32 字符）
```

### 3️⃣ 启动服务

```bash
# 首次启动（从源码构建）
docker compose up -d --build

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 4️⃣ 访问面板

| 地址 | 说明 |
|------|------|
| `http://<IP>:3000` | Web 界面 |
| `http://<IP>:3000/health` | 健康检查 |

### 5️⃣ 更新版本

```bash
git pull
docker compose down
docker compose up -d --build
```

### 6️⃣ 数据备份

数据库文件位于 `./data/database.db`：

```bash
cp ./data/database.db ./data/database.db.backup
```

### 7️⃣ 生产建议

**反向代理（推荐）：**

1. 修改端口映射为 `127.0.0.1:3000:3000`
2. 使用 Nginx/Caddy 终止 TLS，对外开放 80/443

---

## 📦 Docker Hub 镜像部署

不想从源码构建？直接使用预构建镜像：

```bash
docker run -d \
  --name dns-panel \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET=your-secret-here \
  -e ENCRYPTION_KEY=your-32-character-encryption-key!! \
  -e DATABASE_URL=file:/app/data/database.db \
  -v $(pwd)/data:/app/data \
  --restart unless-stopped \
  a3180623/dns-panel:latest
```

> 镜像由 GitHub Actions 自动构建，包含 `latest` 与 `sha` 标签。

---

## 👤 首次使用

1. **注册账号** - 打开 `http://<IP>:3000`，注册管理员账号
2. **添加凭证** - 进入「设置」→「DNS 账户/凭证」，添加服务商 API 凭证
3. **开始管理** - 回到仪表盘，选择服务商与账户，管理域名和记录

> ⚠️ Cloudflare 自定义主机名功能需要 Token 具备 `区域.SSL 和证书（编辑）` 权限；Tunnels 功能需要 `Account: Cloudflare Tunnel（编辑）` + `Zone: DNS（编辑）` 权限。

---

## 🛠️ 本地开发

**前置要求：** Node.js 18+

### 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 | 5173 | Vite 开发服务器 |
| 后端 | 4001 | Express API（可在 `server/.env` 修改） |

> 修改后端端口后，需同步更新 `client/vite.config.ts` 的 proxy target

### 启动命令

**后端：**

```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

**前端（新终端）：**

```bash
cd client
npm install
npm run dev
```

---

## ⚙️ 环境变量

### 必填（生产环境）

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥（建议 32+ 字符） |
| `ENCRYPTION_KEY` | 加密密钥（**必须 32 字符**） |

### 可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CORS_ORIGIN` | - | 允许的前端来源 |
| `JWT_EXPIRES_IN` | `7d` | JWT 过期时间 |
| `LOG_RETENTION_DAYS` | `90` | 日志保留天数 |
| `DATABASE_URL` | - | SQLite 连接串 |
| `SMTP_HOST` | - | SMTP 主机（未在设置中配置 SMTP 时必填） |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | `false` | 是否使用 SMTPS（465） |
| `SMTP_USER` | - | SMTP 用户名（可选） |
| `SMTP_PASS` | - | SMTP 密码（可选） |
| `SMTP_FROM` | - | 发件人（如 `DNS Panel <no-reply@example.com>`） |

> 邮件通知：也可以在「设置」里配置 SMTP；未配置时会使用环境变量 `SMTP_*`。

---

## ❓ 常见问题

<details>
<summary><b>容器启动后无法访问？</b></summary>

```bash
docker compose ps          # 检查容器状态
docker compose logs -f     # 查看日志
curl http://localhost:3000/health  # 测试健康检查
```

</details>

<details>
<summary><b>忘记或修改了 ENCRYPTION_KEY？</b></summary>

更改 `ENCRYPTION_KEY` 后，历史加密的 DNS 凭证将**无法解密**。只能保持原值，或让用户重新录入凭证。

</details>

---

## 🗂️ 项目结构

```text
.
├── client/                           # 前端（React + Vite）
│   └── src/
│       ├── pages/Tunnels.tsx         #   Tunnels 列表页
│       ├── components/Tunnels/       #   Tunnels 组件
│       │   ├── TunnelDetailsPanel.tsx #     详情面板（副本/路由/安装指引）
│       │   └── TunnelPublicHostnamesDialog.tsx  # 路由管理弹窗（三类路由）
│       └── services/tunnels.ts       #   Tunnels API 调用
├── server/                           # 后端（Express + Prisma）
│   └── src/
│       ├── routes/tunnels.ts         #   Tunnels REST API（~1000 行）
│       └── services/cloudflare.ts    #   Cloudflare API 封装
├── docker-compose.yml                # Docker Compose 配置
├── Dockerfile                        # 多阶段构建（前后端一体）
└── .env.example                      # 环境变量示例
```

---

## 📄 许可证

[MIT License](LICENSE)
