# 灵改流桌面启动器

这是 Windows 本地启动器，不需要 Render，也不需要 GitHub Pages。

## 启动

双击：

```text
desktop\start-linggailiu.bat
```

启动器会自动：

- 创建后端 Python 虚拟环境；
- 安装后端依赖；
- 安装前端依赖；
- 启动本地后端 `http://127.0.0.1:8000`；
- 启动本地前端 `http://127.0.0.1:3000`；
- 自动打开浏览器。

## 停止

双击：

```text
desktop\stop-linggailiu.bat
```

## 本地数据位置

默认使用本机 SQLite：

```text
backend\storage\ai_workflow.db
```

上传文件和输出文件在：

```text
backend\storage\
```

## 日志

```text
.desktop-runtime\logs\backend.log
.desktop-runtime\logs\frontend.log
```

## 注意

- 首次启动会安装依赖，可能需要几分钟。
- 本地版本不会被 Render 免费服务休眠影响。
- 大模型调用速度仍取决于你配置的 API / 中转站。
