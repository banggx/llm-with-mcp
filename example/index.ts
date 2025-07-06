import OpenAI from 'openai';
import { LLMWithMCP, type MCPConfig } from '../src';
import dotenv from "dotenv";
dotenv.config();   

const mcpConfig: MCPConfig = {
  "12306-mcp": {
    type: 'command',
    "command": "npx",
    "args": [
      "-y",
      "12306-mcp"
    ]
  }
}

const openai = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: process.env.BASE_URL,
});
const llmWithMCP = new LLMWithMCP({
  openai,
  mcpConfig,
  // debug: true
});

(async () => {
  try {
    await llmWithMCP.initMCPConnect();
    const result = await llmWithMCP.query({
      model: process.env.MODEL as string,
      stream: true,
      messages: [
        { role: 'user', content: '帮我生成一张二次元风格头像图片?' },
      ],
      async streamCallback(body) {
        console.log(body.message);
        if (body.done) {
          await llmWithMCP.cleanup();
        }
      },
    });
    console.log(result);
  } finally {
    // await llmWithMCP.cleanup();
  }
})();