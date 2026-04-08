# HSK Evaluation Frontend

Vue 3 + TypeScript + TailwindCSS 的动态交互式中文评测前端。

## 启动

1. 安装依赖

```bash
npm install
```

1. 配置环境变量

复制 `.env.example` 为 `.env.local`，按你的后端地址调整：

```env
VITE_API_BASE_URL=
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
```

说明：

- `VITE_API_BASE_URL` 为空时，前端以同源路径请求 `/api/...`。
- 开发模式下，Vite 会将 `/api` 代理到 `VITE_API_PROXY_TARGET`。

1. 启动开发服务

```bash
npm run dev
```

1. 生产构建

```bash
npm run build
```

## 主要模块

- `src/composables/useServerTimer.ts`: 服务端时间校准与倒计时管理
- `src/composables/useVisibilityTracker.ts`: 切屏检测并触发 pause/resume
- `src/composables/useEvaluationStream.ts`: SSE 连接、事件解析、断线重连
- `src/components/EvaluationBoard.vue`: 答题主界面与交互流
