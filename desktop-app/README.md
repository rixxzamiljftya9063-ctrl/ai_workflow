# 灵改流桌面软件

这是 Electron 桌面版。它会打开一个独立 Windows 应用窗口，并在后台启动：

- 本地 FastAPI 后端：`127.0.0.1:18000`
- 本地 Next.js 前端：`127.0.0.1:13000`
- 本地 SQLite 数据库：`backend/storage/ai_workflow.db`

## 开发运行

双击：

```text
desktop-app/start-desktop.bat
```

或命令行：

```powershell
cd desktop-app
npm install
npm start
```

## 打包

```powershell
cd desktop-app
npm install
npm run dist
```

安装包会输出到：

```text
desktop-app/dist/
```

## 说明

这是第一版桌面壳。它解决的是“不依赖 Render 免费服务、不用手动开浏览器”的问题。
大模型生成速度仍然取决于你配置的 API 或中转站速度。

桌面版会使用独立端口 `13000/18000`，避免和浏览器开发版常用的 `3000/8000` 冲突。

日志位置：

```text
.desktop-runtime/logs/electron-app.log
.desktop-runtime/logs/backend-electron.log
.desktop-runtime/logs/frontend-electron.log
```
