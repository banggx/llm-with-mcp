## LLM-With-MCP

帮你快速在大模型调用中简单快速的接入 MCP 服务调用

**快速开始**

```bash
pnpm add llm-with-mcp
```

**在项目中使用**

1. 同步调用

```ts
import OpenAI from 'openai';
import { LLMWithMCP, type MCPConfig } from 'llm-with-mcp';

const mcpConfig = {
  "12306-mcp": {
    type: 'command',
    "command": "npx",
    "args": [
      "-y",
      "12306-mcp"
    ]
  }
};

(async () => {
  try {
    const openai = new OpenAI({
      apiKey: 'API_KEY',
      baseURL: 'BASE_URL',
    });
    const llmWithMCP = new LLMWithMCP({
      openai,
      mcpConfig,
    });
    // 初始化 MCP 服务链接
    await llmWithMCP.initMCPConnect();
    const result = await llmWithMCP.query({
      model: 'MODEL',
      messages: [
        { role: 'user', content: '今天北京到上海的高铁班次有哪些?' },
      ],
    });
    console.log(result);
  } finally {
    await llmWithMCP.cleanup();
  }
})();
```

2. 使用 `stream` 模式调用

```ts
// ... 省略初始化代码
await llmWithMCP.query({
  model: 'MODEL',
  tream: true,
  messages: [
    { role: 'user', content: '今天北京到上海的高铁班次有哪些?' },
  ],
  async streamCallback(body) {
    console.log(body.message);
    if (body.done) {
      await llmWithMCP.cleanup();
    }
  },
});
```