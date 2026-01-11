# 🌐 DNS Panel

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://hub.docker.com/r/a3180623/dns-panel)

> 现代化的多 DNS 服务商统一管理面板：多用户、多凭证隔离，统一管理域名与 DNS 解析记录，并提供操作日志审计。

---

## 📑 目录

- [功能概览](#-功能概览)
- [支持的服务商](#-支持的服务商)
- [技术栈](#-技术栈)
- [快速部署](#-快速部署docker-compose)
- [Docker Hub 镜像](#-docker-hub-镜像部署)
- [首次使用](#-首次使用)
- [本地开发](#-本地开发)
- [环境变量](#️-环境变量)
- [常见问题](#-常见问题)

---

## ✨ 功能概览

| 功能 | 说明 |
|------|------|
| 🌐 多服务商支持 | 统一管理多个 DNS 服务商的域名和解析记录 |
| 🧾 解析记录管理 | 增删改查；支持权重/线路/启停/备注等 |
| ☁️ Cloudflare 增强 | 自定义主机名、证书状态、Fallback Origin |
| 🔑 多用户隔离 | JWT 登录、账户与凭证隔离 |
| 🔒 安全存储 | DNS 凭证加密存储（AES-256） |
| 💾 数据持久化 | SQLite 数据库，挂载 Volume 即可备份迁移 |

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

> ⚠️ Cloudflare 自定义主机名功能需要 Token 具备 `SSL and Certificates:Edit` 权限

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
├── client/               # 前端（React + Vite）
├── server/               # 后端（Express + Prisma）
├── docker-compose.yml    # Docker Compose 配置
├── Dockerfile            # 多阶段构建（前后端一体）
└── .env.example          # 环境变量示例
```

---

## 📄 许可证

[MIT License](LICENSE)
