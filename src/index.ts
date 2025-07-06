import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import logger from './logger';
import { LLMWithMCPLib } from './config';
import { noop } from './util';
import type OpenAI from 'openai';
import type { ChatCompletionMessageToolCall, ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { LLMWITHMCPOptions, QueryOptions, MCPConfig, MCPServer, CallToolResult, StreamCallback } from './types';
export * from './types';

type ToolCall = ChatCompletionChunk.Choice.Delta.ToolCall;

export class LLMWithMCP {
  private openai: OpenAI;
  private mcpConfig?: MCPConfig;
  private sessions: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport | SSEClientTransport> = new Map();
  private opts: LLMWITHMCPOptions;
  constructor(opts: LLMWITHMCPOptions) {
    this.openai = opts.openai;
    this.mcpConfig = opts.mcpConfig;
    this.opts = opts;
    if (opts.debug) {
      logger.level = 'debug';
    }
  }

  async initMCPConnect() {
    if (!this.mcpConfig) {
      logger.warn('MCP config is not provided');
      return;
    }
    const promises = [];
    for (const serverName in this.mcpConfig) {
      promises.push(this.connectToMcp(serverName, this.mcpConfig[serverName]));
    }
    return Promise.all(promises);
  }

  private async connectToMcp(serverName: string, server: MCPServer) {
    let transport: StdioClientTransport | SSEClientTransport;
    switch (server.type) {
      case 'command':
        transport = this.createCommandTransport(server);
        break;
      case 'sse':
        transport = this.createSSETransport(server);
        break;
      default:
        logger.warn(`Unknown server type: ${(server as any).type}`);
    }
    const client = new Client(
      LLMWithMCPLib,
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {}
        }
      }
    );
    
    await client.connect(transport);
    this.sessions.set(serverName, client);
    this.transports.set(serverName, transport);
    logger.debug(`Connected to MCP server ${serverName}`);
  }

  private createCommandTransport(server: Extract<MCPServer, { type: 'command' }>) {
    const { command, args, opts = {} } = server;
    
    if (!command) {
      throw new Error('Invalid command');
    }

    return new StdioClientTransport({
      command,
      args,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => !!v)
      ),
      ...opts
    });
  }

  private createSSETransport(server: Extract<MCPServer, { type: 'sse' }>) {
    const { url, opts } = server;
    return new SSEClientTransport(new URL(url), opts)
  }

  async query(opts: QueryOptions) {    
    const availableTools = await this.listMCPTools();

    if (availableTools.length) {
      if (!opts.tools) {
        opts.tools = [];
      }
      opts.tools.push(...availableTools);
      opts.tool_choice = 'auto';
    }

    if (!opts.stream) {
      let finalText: string[] = [];
      await this.queryWithAI(opts as Extract<QueryOptions, { stream: false }>, (message) => finalText.push(message));
      return finalText.join('\n');
    } else {
      this.streamQueryWithAI(opts as Extract<QueryOptions, { stream: false }>, opts?.streamCallback || noop);
    }
  }

  private async listMCPTools() {
    const availableTools: any[] = [];
    for (const [serverName, session] of this.sessions) {
      const response = await session.listTools();
      if (this.opts.debug) {
        logger.debug(`List tools from MCP server ${serverName}: ${response.tools.map((tool: Tool) => tool.name).join(', ')}`);
      }
      const tools = response.tools.map((tool: Tool) => ({
        type: 'function' as const,
        function: {
          name: `${LLMWithMCPLib.symbol}__${serverName}__${tool.name}`,
          description: `[${serverName}] ${tool.description}`,
          parameters: tool.inputSchema
        }
      }));
      availableTools.push(...tools);
    }
    return availableTools;
  }

  private async streamQueryWithAI(opts: Extract<QueryOptions, { stream?: true }>, callback: StreamCallback) {
    const stream = await this.openai.chat.completions.create(opts);

    let streamToolMessage: ToolCall[] = [];
    const callTools: ToolCall[] = [];
    for await (const event of stream) {
      const choice = event.choices[0];
      const delta = choice.delta;
      const isDone = choice.finish_reason === 'stop';
      if (isDone) {
        callback({ message: delta.content, done: true });
        break;
      }
      if (delta?.content) {
        callback({ message: delta.content, done: isDone });
      }
      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          streamToolMessage.push(toolCall);
        }
      }
      if (streamToolMessage.length && choice.finish_reason === 'tool_calls') {
        const tool = this.assignStreamToolCall(streamToolMessage);
        streamToolMessage = [];
        if (tool) {
          callTools.push(tool);
        }
      }
    }

    if (callTools.length) {
      await Promise.all(callTools.map(async (tool) => {
        const { name: toolName, arguments: toolArgs } = tool.function;
        logger.debug(`Calling tool ${toolName} with args ${toolArgs}`);
        const result = await this.callTool(tool as any, opts);
        if (!result) {
          return;
        }
        logger.debug(`Tool ${toolName} response ${result}`);
        callback({ message: this.formatCallToolContent(tool, result), done: false });

        opts.messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [tool as any]
        });
        opts.messages.push({
          role: 'tool',
          tool_call_id: tool.id,
          content: result
        });
      }));
      this.streamQueryWithAI(opts, callback);
    }
  }

  private async queryWithAI(opts: Extract<QueryOptions, { stream?: false }>, callback: (message: string) => void) {
    const completion = await this.openai.chat.completions.create(opts);
    
    for (const choice of completion.choices) {
      const message = choice.message;
      if (message.content) {
        callback(message.content);
      }
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          const { name: toolName, arguments: args } = toolCall.function;
          logger.debug(`Calling tool ${toolName} with args ${args}`);
          const result = await this.callTool(toolCall, opts);

          if (!result) {
            continue;
          }

          logger.debug(`Tool ${toolName} response ${result}`);
          callback(this.formatCallToolContent(toolCall as any, result));
          
          opts.messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [toolCall]
          });
          opts.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result
          });
          await this.queryWithAI(opts, callback);
        }
      }
    }
  }

  private assignStreamToolCall(messages: ToolCall[]) {
    if (!messages.length) return;
    
    const tool = messages[0];
    messages.slice(1).reduce((acc, item) => {
      if (item.id) {
        acc.id = item.id;
      }
      if (item.function?.name) {
        acc.function.name = item.function.name;
      }
      if (item.function?.arguments) {
        acc.function.arguments = (acc.function?.arguments || "") + item.function.arguments;
      }
      return acc;
    }, tool);

    return tool;
  }

  private async callTool(tool: ChatCompletionMessageToolCall, opts: QueryOptions) {
    let toolName = tool.function.name;
    const toolArgs = JSON.parse(tool.function.arguments);

    let result: CallToolResult;
    if (!toolName.startsWith(LLMWithMCPLib.symbol)) {
      result = await opts.callTools?.(toolName, toolArgs) as CallToolResult;
    } else {
      const [, serverName, tool] = toolName.split('__');
      toolName = tool;
      const session = this.sessions.get(serverName);
      if (!session) {
        logger.warn(`MCP session ${serverName} is not connected`);
        return;
      }

      result = await session.callTool({
        name: tool,
        arguments: toolArgs
      }) as CallToolResult;
    }

    if (!result) return;

    const content = this.formatToolsContent(result.content);
    if (result.isError) {
      logger.error(`Call tool ${toolName} failed: ${content}`);
    }

    return content;
  }

  private formatToolsContent(content: CallToolResult['content']) {
    return content.reduce((text, item) => {
      switch (item.type) {
        case 'text':
          text += item.text;
          break;
        case 'image':
          text += item.data;
          break;
        case 'audio':
          text += item.data;
          break;
      }
      return text;
    }, '');
  }

  private formatCallToolContent(tool: ToolCall, result: any) {
    const { name: toolName, arguments: toolArgs } = tool.function;
    return `<tool>
      <header>Calling ${toolName} Tool.</header>
      <code class="tool-args">${toolArgs}</code>
      <code class="tool-resp">${JSON.stringify(result, null, 2)}</tool-output>
    </tool>`
  }

  async cleanup() {
    for (const transport of this.transports.values()) {
      await transport.close();
    }
    this.transports.clear();
    this.sessions.clear();
  }
}