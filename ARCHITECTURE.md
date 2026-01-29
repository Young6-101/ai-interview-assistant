# 项目架构文档

## 系统架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    用户浏览器 (React)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         前端应用 (ainterview-web)                    │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │ App.tsx (with InterviewProvider)               │  │  │
│  │  │  ├─ Login.tsx (认证)                           │  │  │
│  │  │  └─ Interview.tsx (主面试页面)                │  │  │
│  │  │      ├─ MeetingRoom.tsx (HR + Candidate)      │  │  │
│  │  │      └─ QuestionList.tsx (历史 + 建议)        │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │ Context & Hooks                               │  │  │
│  │  │  ├─ InterviewContext (全局状态)               │  │  │
│  │  │  ├─ useWebSocket (WebSocket通信)              │  │  │
│  │  │  ├─ useAudioCapture (音频捕获)                │  │  │
│  │  │  ├─ useQuestions (提问管理)                   │  │  │
│  │  │  └─ useMeetingRoom (屏幕共享)                 │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  Services                                             │  │
│  │  └─ api.ts (HTTP API 调用)                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↓ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                   后端服务器 (FastAPI)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         main.py (FastAPI 应用)                      │  │
│  │  ├─ CORS 中间件                                    │  │
│  │  ├─ 静态文件服务                                   │  │
│  │  └─ WebSocket 路由                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Routes (API 端点)                           │  │
│  │  ├─ routes/auth.py        (身份验证)               │  │
│  │  ├─ routes/interview.py    (面试管理)              │  │
│  │  └─ routes/survey.py       (问卷调查)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Models (数据库模型)                         │  │
│  │  ├─ models/user.py         (用户)                 │  │
│  │  ├─ models/interview.py    (面试)                 │  │
│  │  └─ models/survey.py       (问卷)                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Core Services                               │  │
│  │  ├─ realtime_analyzer.py   (OpenAI Realtime API)   │  │
│  │  ├─ services/interview_service.py (业务逻辑)      │  │
│  │  └─ database/db.py          (数据库连接)          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         外部集成                                     │  │
│  │  ├─ OpenAI Realtime API     (弱点分析)              │  │
│  │  ├─ AssemblyAI              (语音转录)              │  │
│  │  └─ SQLite/PostgreSQL       (数据库)               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 数据流

### 1. 登录流程

```
用户输入用户名/密码
    ↓
POST /auth/login
    ↓
验证凭证
    ↓
生成 JWT Token
    ↓
返回 token，存储在 localStorage
    ↓
重定向到 /interview
```

### 2. 创建面试流程

```
输入候选人名称 + 选择模式
    ↓
POST /api/interview/create
    ↓
后端创建 Interview 记录
  - status = ONGOING
  - mode = selected_mode
  - start_time = now()
    ↓
返回 interview_id
    ↓
设置 InterviewContext
    ↓
进入 MeetingRoom
```

### 3. 实时通信流程

```
前端 (WebSocket Client)
    ↓ 连接
后端 (WebSocket Handler)
    ↓
建立持久连接

HR输入问题并提交
    ↓ send('new_transcript', {...})
后端接收
    ↓
分类问题 (classify_question)
    ↓ send('question_classified', {...})
前端接收，更新 Context
    ↓
Candidate 提交回答
    ↓ send('new_transcript', {...})
后端接收
    ↓
分析弱点 (analyze_weak_points)
    ↓ send('weak_points', {...})
前端接收，显示在 UI 中
```

### 4. 面试保存流程

```
用户点击"End Interview"
    ↓
收集 InterviewContext 中的所有数据
    ↓
POST /api/interview/{interview_id}/save
    ↓
后端更新 Interview 记录
  - status = COMPLETED
  - transcripts = [...]
  - weak_points = [...]
  - questions_asked = [...]
  - suggested_questions = [...]
  - end_time = now()
    ↓
计算面试时长
    ↓
保存到数据库
    ↓
返回成功响应
    ↓
前端清空 Context
    ↓
重定向或显示完成提示
```

---

## 核心模块详解

### 前端模块

#### 1. **InterviewContext** 
全局状态容器，管理：
- 面试基本信息 (candidateName, mode, interviewId)
- 动态数据 (transcripts, weakPoints, questionsAsked, suggestedQuestions)
- 当前框架选择

```typescript
interface InterviewContextType {
  mode: 'mode1' | 'mode2' | 'mode3'
  candidateName: string
  interviewId: string | null
  transcripts: TranscriptItem[]
  weakPoints: WeakPoint[]
  questionsAsked: string[]
  suggestedQuestions: any[]
  currentFramework: string
  // ... methods
}
```

#### 2. **useWebSocket Hook**
WebSocket 连接管理：
- 自动重新连接
- 消息发送/接收
- 事件订阅系统

```typescript
const { send, on, isConnected } = useWebSocket('ws://...')

// 订阅事件
on('new_transcript', (data) => { ... })

// 发送消息
send('new_transcript', { speaker: 'hr', text: '...' })
```

#### 3. **useAudioCapture Hook**
音频捕获和处理：
- 麦克风权限请求
- AudioWorklet 处理
- 音频数据流

```typescript
const { startCapture, stopCapture, isRecording } = useAudioCapture()

await startCapture({
  speaker: 'hr',
  onAudioData: (data) => { ... }
})
```

#### 4. **MeetingRoom 组件**
核心交互组件：
- HR 侧：提问输入 + 录音
- Candidate 侧：回答输入 + 录音
- 实时转录显示
- 弱点分析面板 (mode2/3)

#### 5. **QuestionList 组件**
问题历史和建议：
- 已提问的问题列表
- AI 建议的后续问题
- 复制/使用功能

### 后端模块

#### 1. **realtime_analyzer.py**
OpenAI Realtime API 集成：
- 连接管理
- 模式切换 (HR分类/弱点分析)
- 函数调用处理
- 回调机制

```python
analyzer = RealtimeWeakPointAnalyzer(
  on_classification=async_callback,
  on_weak_points=async_callback
)

await analyzer.connect()
await analyzer.classify_question("Tell me about yourself")
await analyzer.analyze_weak_points("star", question, answer)
```

#### 2. **routes/interview.py**
面试 API 端点：
- `POST /api/interview/create` - 创建面试
- `POST /api/interview/{id}/save` - 保存面试数据
- `GET /api/interview/{id}` - 获取面试详情
- `GET /api/interview/list` - 列表查询
- `DELETE /api/interview/{id}` - 删除面试
- `PATCH /api/interview/{id}/status` - 更新状态

#### 3. **models/interview.py**
Interview 数据模型：
- 基本信息 (候选人、模式、状态)
- 动态数据字段 (JSON 格式)
  - `transcripts` - 转录列表
  - `weak_points` - 弱点分析
  - `questions_asked` - 提问记录
  - `suggested_questions` - 建议问题
- 时间戳字段
- 关系映射

#### 4. **WebSocket 处理**
- 连接管理
- 消息路由
- 事件分发

---

## 数据库模式

### Interview 表

```sql
CREATE TABLE interviews (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  candidate_name VARCHAR(100),
  candidate_email VARCHAR(100),
  mode VARCHAR(10),  -- mode1, mode2, mode3
  status VARCHAR(20),  -- ongoing, completed, cancelled
  start_time DATETIME DEFAULT NOW(),
  end_time DATETIME,
  duration INTEGER,
  
  -- JSON 数据字段
  transcript JSON DEFAULT '[]',
  transcripts JSON DEFAULT '[]',
  weak_points JSON DEFAULT '[]',
  questions_asked JSON DEFAULT '[]',
  suggested_questions JSON DEFAULT '[]',
  
  created_at DATETIME DEFAULT NOW(),
  updated_at DATETIME DEFAULT NOW(),
  
  FOREIGN KEY (user_id) REFERENCES users(id)
)
```

---

## API 端点参考

### 认证
- `POST /auth/login` - 登录
- `POST /auth/register` - 注册
- `GET /auth/me` - 获取当前用户

### 面试
- `POST /api/interview/create` - 创建新面试
- `POST /api/interview/{id}/save` - 更新面试数据
- `GET /api/interview/{id}` - 获取面试详情
- `GET /api/interview/list` - 列表查询
- `DELETE /api/interview/{id}` - 删除面试
- `PATCH /api/interview/{id}/status` - 更新状态

### WebSocket
- `/ws` - WebSocket 连接端点

---

## 消息格式规范

### 转录消息

```json
{
  "type": "new_transcript",
  "payload": {
    "id": "unique_id",
    "speaker": "hr" | "candidate",
    "text": "transcript text",
    "timestamp": 1234567890,
    "session_id": "interview_uuid"
  }
}
```

### 弱点分析消息

```json
{
  "type": "weak_points",
  "payload": {
    "weak_points": [
      {
        "component": "weakness description",
        "severity": "high" | "medium" | "low",
        "question": "follow-up question",
        "highlights": ["keyword1", "keyword2"]
      }
    ]
  }
}
```

### 问题分类消息

```json
{
  "type": "question_classified",
  "payload": {
    "is_question": true,
    "question_type": "behavioral_question",
    "text": "question text",
    "confidence": "high" | "medium" | "low",
    "frameworks": ["star"]
  }
}
```

---

## 模式说明

### Mode 1 - Normal
- 标准面试流程
- 无 AI 提示词
- 简洁 UI

### Mode 2 - AI Hints (On Demand)
- 需要时显示 AI 提示词
- 弱点分析面板可见
- 建议问题列表可见

### Mode 3 - Always Show Hints
- 始终显示 AI 提示词
- 实时更新弱点分析
- 建议问题持续显示

---

## 安全性考虑

1. **认证**: JWT Token 验证
2. **授权**: 用户只能访问自己的面试记录
3. **输入验证**: Pydantic 模型验证
4. **CORS**: 配置跨域请求
5. **环境变量**: 敏感信息存储

---

## 性能优化

1. **前端**
   - 虚拟滚动（长列表）
   - 组件懒加载
   - 状态缓存

2. **后端**
   - 数据库查询优化
   - WebSocket 消息批处理
   - 缓存层（可选）

3. **通信**
   - 音频数据压缩
   - 增量数据传输
   - 消息去重

---

## 扩展点

1. **存储**: 可切换为 PostgreSQL/MongoDB
2. **实时API**: 可集成其他 LLM 服务
3. **转录**: 可集成不同的转录服务
4. **认证**: 可支持 OAuth/SAML
5. **导出**: 可生成面试报告

---

**最后更新**: 2026-01-29
