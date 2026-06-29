# AI Workflow Builder

一个本地可运行的全栈 MVP：ProcessOn 风格画布、AI 工作流节点、多 API / Agent 协同执行、运行日志、结构化交叉验证、代码执行、Markdown 输出、合规检查，以及不含 API Key 的 `workflow.json` 导入导出。

## 核心产品模型

当前主界面优先展示 3 个核心模块：

- `API 调用`：从项目级已配置的 API / Agent 中选择一个调用，并在同一个节点内配置 system prompt、prompt summary、prompt template、temperature、max tokens、output key。
- `Skills / 节点工作流`：保存 Markdown Skill 指令，读取上游 API 的完整 `output_json`，整理成可继续传给下游 API 或交叉验证节点的结果。
- `交叉验证`：支持多个输入，输出合法结构化 JSON，并按 `agreement`、`conflict`、`missing`、`logic_error`、`risk`、`revision_tasks` 分类。

执行语义是同步 DAG：每个节点完整执行结束后，才把完整 `output_json` 沿箭头传给下一个节点，不做 token streaming 或逐字传递。交叉验证后的箭头可以填写 `condition` 标签，例如 `conflict`，下游 API 会收到对应分类的子结果；不填写 `condition` 时传递完整上游输出。

## Material Store 与上下文包

为了避免复杂资料型流程只靠上一节点摘要一路丢信息，runner 在每次运行中维护一个轻量 `Workflow State`：

- `materials`：由 `Start` 节点把手写文本、项目全部文件或指定文件写入本次 run 的资料库，并切分为 `sources` 和 `chunks`。
- `artifacts`：每个节点成功后，把标准化产物写入 `workflow_state.artifacts[node_id]`。
- `node_outputs`：继续保留原始节点 `output_json`，方便调试和兼容旧工作流。
- `global_warnings`：记录 selected paths 或 required artifacts 缺失等非阻断警告。

API、Skill、Cross Review 等节点执行前会由 Context Builder 生成 `context_package`，可包含：

- `previous_outputs`：按箭头传来的上游输出；
- `selected_artifacts`：从历史产物中按 `required_artifacts` 选出的内容；
- `retrieved_material_chunks`：从 Material Store 中按关键词检索出的资料片段；
- `source_refs`、`missing_context`、`is_context_sufficient`。

节点 prompt 可使用这些变量：

```text
{{context_package}}
{{previous_output}}
{{selected_artifacts}}
{{retrieved_material_chunks}}
{{input}}
```

兼容策略：老工作流节点如果没有 `context_config`，后端会走旧逻辑 `full_previous`，只使用箭头传来的上游输出，不会强制启用资料检索。新建节点和模板会自动带默认 `context_config`。

支持的 `context_mode`：

- `previous_only`：只使用直接上游输出；
- `full_previous`：使用上游完整输出，兼容旧逻辑；
- `selected_paths`：只抽取指定路径；
- `material_retrieval`：从本次 run 的 Material Store 检索资料 chunks；
- `hybrid`：同时使用上游输出、历史 artifacts 和资料 chunks。

如果模型输出 `need_more_context=true` 且包含 `retrieval_queries`，后端最多自动追加检索资料并重试当前 API / Skill 节点一次，重试信息会记录在 run step 的 `retry_info` 中。

## 箭头传递模式

点击画布上的连线，可以在右侧配置：

- `transfer_mode=full_output`：默认模式，传递完整上游 `output_json`；
- `transfer_mode=selected_paths`：按 `selected_paths` 只传部分字段；
- `transfer_mode=artifact_only`：只传上游标准化 `artifact`；
- `transfer_mode=condition_route`：用于交叉验证分类路由，例如 `condition=conflict`。

`selected_paths` 示例：

```json
[
  {
    "from_path": "output_json.artifact.outline",
    "to_key": "outline"
  }
]
```

路径不存在时不会中断运行，会写入 `workflow_state.global_warnings`。

## 技术栈

- 后端：FastAPI、SQLite、SQLAlchemy、Pydantic、httpx、本地文件存储
- 前端：Next.js、TypeScript、React Flow、Tailwind CSS
- 第一版不包含登录、注册、支付、多租户和复杂权限。

## 安装依赖

后端：

```powershell
cd G:\AI\WorkSpace\网站\ai_workflow\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

前端：

```powershell
cd G:\AI\WorkSpace\网站\ai_workflow\frontend
npm install
```

## 启动后端

```powershell
cd G:\AI\WorkSpace\网站\ai_workflow\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

健康检查：

```text
http://127.0.0.1:8000/health
```

## 启动前端

```powershell
cd G:\AI\WorkSpace\网站\ai_workflow\frontend
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

## 数据与存储位置

- SQLite：`backend/storage/ai_workflow.db`
- 上传文件：`backend/storage/projects/{project_id}/files/`
- 代码执行 workspace：`backend/storage/projects/{project_id}/workspace/`
- 输出文件：`backend/storage/projects/{project_id}/outputs/`

## 如何创建项目

1. 打开前端首页。
2. 输入项目名称和描述。
3. 点击“新建项目”。
4. 进入项目详情页。

## 如何配置 API / Agent

在项目详情页的 `API / Agent 配置` 中可以添加多个 API / Agent。每个 Agent 可以配置名称、描述、API 类型、Base URL、API Key、模型、temperature 和 max tokens。画布中的 `API 调用` 节点会从这些已配置 Agent 中选择。

点击“添加 mock agent”可以创建本地 mock Agent。mock Agent 不调用外部 API，可完整演示：

- `text_input -> api_call -> export`
- `api_call -> skill -> api_call`
- `api_call A + api_call B -> skill -> cross_review -> api_call 修订`
- `file_input -> llm_call -> parallel_llm -> cross_review -> code_generation -> code_execution -> result_validation -> document_write -> compliance_check -> export`

API Key 只保存在后端。前端只显示脱敏后的 `api_key_masked`。`workflow.json` 只保存 `provider_id`，导出时不会包含 `api_key`。

## 如何使用画布节点库

1. 打开任意工作流编辑页。
2. 左侧默认展开核心模块：`API 调用`、`Skills / 节点工作流`、`交叉验证`。其他兼容节点按输入、AI、逻辑、数据、工具、输出、检查分类折叠。
3. 可通过搜索框查找节点名称、类型或说明。
4. 将节点卡片拖拽到画布中。
5. 支持两种连线方式：
   - 拖拽节点左右连接点创建连线；
   - 点击顶部“连线模式”，先点源节点，再点目标节点。
6. 点击 API 节点后，右侧面板分为“API 配置”和“提示词配置”。API 配置中选择项目页已经配置好的 API / Agent，并显示该 Agent 的描述、模型和脱敏 key。点击 Skill 节点后，可编辑 Markdown Skill。点击箭头后，可填写 `condition` 路由标签。

新增节点类型在 `frontend/lib/workflow.ts` 的 `nodeCatalog` 中配置。每个节点需要提供：

- `type`：后端 runner 识别的节点类型；
- `label`：中文显示名；
- `icon`：`lucide-react` 图标名；
- `description`：一句话说明；
- `category`：节点库分类；
- `implementedAs`：可选，映射到已有 runner 节点。

## 如何运行空白工作流

1. 项目详情页添加 mock agent。
2. 点击“新建空白工作流”。
3. 在画布左侧添加 `文本输入`、`API 调用`、`导出工作流`。
4. 依次连线：`text_input -> api_call -> export`。
5. 选中 `api_call`，选择 mock agent，确认 prompt 中包含 `{{previous_output}}` 或 `{{input}}`。
6. 点击顶部“保存”，再点击“运行”。
7. 打开运行详情页，查看每个节点的 `input_json`、`output_json`、`status`、`error_message`、`duration_ms`。

## 如何运行 API + Skills + 交叉验证模板

1. 项目详情页添加至少一个 mock agent，建议添加两个，用描述区分不同 Agent 的任务角色。
2. 在模板库选择“API + Skills + 交叉验证工作流”。
3. 打开画布，可看到：
   - `输入材料 -> API 主方案`
   - `输入材料 -> API 备选方案`
   - 两个 API 完整输出进入 `Skills 整理`
   - `Skills 整理 -> 交叉验证`
   - `交叉验证 -> API 修订冲突`，连线 `condition=conflict`
   - `交叉验证 -> API 补全遗漏`，连线 `condition=missing`
4. 点击“保存”和“运行”。
5. 在运行日志或运行详情页查看 `skill_output`、`cross_review.routed_outputs`，以及下游 API 的 `input_json.upstream` 是否只包含对应分类内容。

## 如何运行数学建模模板

1. 项目详情页添加至少一个 mock agent，建议添加两个。
2. 上传 `backend/samples/sample_problem.txt`。
3. 在项目页点击“新建数学建模模板”，或在画布顶部点击“模板”并选择“数学建模多模型交叉验证工作流”。
4. 打开画布，选中第一个 `file_input` 节点，选择上传的 sample 文件。
5. 检查各模型节点的 API / Agent 选择，必要时手动选择 mock agent。
6. 点击“保存”和“运行”。
7. 在运行详情页查看：
   - `parallel_llm` 的多模型结果；
   - `cross_review` 的结构化 JSON；
   - `code_execution` 的 stdout、stderr、exit_code、error_message；
   - `document_write` 保存的 Markdown 路径；
   - `compliance_check` 的 passed、issues、revision_instructions。

## 如何运行 PPT 资料工作流

1. 项目详情页添加 mock agent。
2. 上传资料文件，或在 `Start 资料入口` 节点填写手写文本。
3. 在画布顶部点击“模板”，选择“PPT 生成工作流”。
4. 确认流程为：
   `Start -> 需求解析 -> 资料分析 -> 大纲生成 -> 单页内容生成 -> 图表规划 -> 布局设计 -> 质量检查 -> PPT 输出 -> Export`。
5. 点击“保存”和“运行”。
6. 在右侧实时输出或运行详情页查看每个节点的 `context_package`、`retrieved_material_chunks`、`source_refs`、`missing_information` 和 `retry_info`。

该模板的默认上下文策略：

- `需求解析`：`full_previous`，包含资料，最多 6 个 chunks；
- `资料分析`：`material_retrieval`，包含资料，最多 20 个 chunks；
- `大纲生成`：`hybrid`，需要 `requirement`、`material_summary`，最多 10 个 chunks；
- `单页内容生成`：`hybrid`，需要 `outline`，最多 8 个 chunks；
- `图表规划`：`hybrid`，需要 `slides_content`，最多 8 个 chunks；
- `布局设计`：`selected_paths`，需要 `slides_content`、`visual_plan`；
- `质量检查`：`hybrid`，需要 `requirement`、`outline`、`slides_content`、`visual_plan`、`layout_plan`，最多 15 个 chunks。

## workflow.json 导出和导入

导出：

1. 在画布页点击“导出”，下载当前前端画布格式。
2. 或访问后端导出接口 `/api/workflows/{workflow_id}/export`，得到带 `required_providers` 和 `security_note` 的运行包。
3. 下载的 JSON 包含 nodes、edges、`data.icon`、`data.config`、variables、version。
3. 导出内容不包含 `api_key`。

导入：

1. 回到项目详情页。
2. 点击“导入 workflow.json”。
3. 选择之前导出的 JSON。
4. 打开导入后的工作流，画布会恢复节点和连线。

## 如何使用嵌入功能

1. 打开工作流画布。
2. 点击顶部“嵌入”。
3. 弹窗会展示三种方式：
   - `workflow.json` 嵌入示例；
   - API 调用示例；
   - iframe 嵌入示例。
4. iframe 示例页面地址：

```text
http://127.0.0.1:3000/embed/workflows/{workflow_id}
```

嵌入页只显示轻量运行面板，不显示完整编辑器。用户可以输入 `input` 并点击运行。第一版后端 runner 仍主要读取节点配置中的输入；API 已接受 `inputs` payload，但部分节点暂未消费该 payload，因此嵌入能力目前适合本地或内网演示。

## 真实 API 接入

在项目详情页新增 API / Agent：

- `openai_compatible` 或 `custom`：填写中转站/官方兼容地址，例如 `https://api.example.com/v1`
- `deepseek`：第一版按 OpenAI Compatible `/chat/completions` 调用
- `anthropic`：第一版保留配置字段，但 runner 会返回“暂未完整支持”

真实 API 调用失败会写入运行步骤错误，不会导致后端崩溃。

## 已知限制

- 执行引擎第一版按 DAG 顺序执行，不支持循环、人工暂停、条件分支跳过后续节点。
- Material Store 是单次 run 内的内存/JSON 状态，保存在 run final output 中；第一版不是持久化向量库。
- 资料检索是关键词和简单相关性排序，不是 embedding 检索。
- 交叉验证连线的 `condition` 已支持分类路由；独立的 `condition` 节点只输出判断结果，暂未改变 DAG 执行路径。
- `loop`、`retry`、`human_review` 第一版作为流程占位或 pass-through，不会暂停真实执行。
- `http_request`、`database_query`、`ppt_output`、`word_output` 第一版按 MVP 占位节点处理，不执行真实外部请求、数据库查询或 Office 文件生成。
- iframe 嵌入页没有权限系统，仅建议用于本地或内网演示。
- `anthropic` 类型保留但未完整实现。
- PDF/docx/xlsx 文本提取尽力而为，复杂版式可能提取不完整。
- 代码执行 MVP 仅允许 Python 命令，并拒绝危险命令、父目录访问和 workspace 逃逸。
- 没有用户系统，所有项目默认本机可信用户可访问。

## 发布到 GitHub

本项目建议作为独立仓库发布，不要把上级目录里的其它项目一起提交。

发布前检查：

```powershell
cd G:\AI\WorkSpace\网站\ai_workflow\backend
python -m compileall app

cd G:\AI\WorkSpace\网站\ai_workflow\frontend
npm run typecheck
```

初始化并提交：

```powershell
cd G:\AI\WorkSpace\网站\ai_workflow
git init
git add .
git commit -m "Initial AI Workflow Builder MVP"
git branch -M main
```

在 GitHub 新建一个空仓库后，把下面的 `YOUR_NAME/YOUR_REPO` 换成真实地址：

```powershell
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

不要提交这些内容：

- `backend/storage/`
- `backend/.venv/`
- `frontend/node_modules/`
- `frontend/.next/`
- `.env`
- 任何真实 API Key

## 公网部署建议

本项目是前后端分离架构：

- Backend: FastAPI + SQLite，适合部署到 Render、Railway、Fly.io、VPS 等支持 Python Web 服务和持久磁盘的平台。
- Frontend: Next.js，适合部署到 Vercel、Netlify 或同一台 VPS。

部署时需要配置：

Backend 环境变量：

```text
DATABASE_URL=sqlite:///./storage/ai_workflow.db
STORAGE_ROOT=./storage
FRONTEND_ORIGIN=https://你的前端域名
```

Frontend 环境变量：

```text
NEXT_PUBLIC_API_BASE_URL=https://你的后端域名
```

注意：SQLite 需要持久磁盘；如果部署平台没有持久磁盘，重启后项目、Provider、上传文件和运行记录可能丢失。多人长期使用建议后续迁移到 PostgreSQL，并增加登录和权限系统。

## Render 一键部署

仓库已包含 `render.yaml`，可以用 Render Blueprint 创建两个服务：

- `ai-workflow-backend`：FastAPI 后端
- `ai-workflow-frontend`：Next.js 前端

部署步骤：

1. 打开 Render Blueprint 页面：

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/rixxzamiljftya9063-ctrl/ai_workflow
```

2. 登录 Render，并授权连接 GitHub。
3. 选择本仓库，确认 Blueprint。
4. 点击 `Apply` 开始部署。
5. 部署完成后，打开：

```text
https://ai-workflow-frontend.onrender.com
```

后端健康检查地址：

```text
https://ai-workflow-backend.onrender.com/health
```

Render 免费实例冷启动会比较慢，首次访问可能需要等待几十秒。

重要限制：

- 当前 Render 配置使用 SQLite 本地文件，适合演示，不适合多人长期生产使用。
- 免费实例重新部署或休眠恢复时，上传文件和数据库可能不稳定。
- 正式多人使用建议迁移到 PostgreSQL，并给后端配置持久磁盘或对象存储。
- 如果你在 Render Dashboard 修改了服务名称，需要同步修改：
  - 后端 `FRONTEND_ORIGIN`
  - 前端 `NEXT_PUBLIC_API_BASE_URL`
