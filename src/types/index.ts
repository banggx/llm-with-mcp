import type { MCPConfig } from './common';
import type OpenAI from 'openai';
import type{ ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
export * from './common';

export interface LLMWITHMCPOptions {
  openai: OpenAI;
  mcpConfig?: MCPConfig;
  debug?: boolean;
}

export type ToolContent = 
  | {
    type: 'text';
    text: string;
  }
  | {
    type: 'image',
    data: string;
    mimeType: string;
  }
  | {
    type: 'audio',
    data: string;
    mimeType: string;
  };

export interface CallToolResult {
  content: Array<ToolContent>;
  isError?: boolean;
}

export type StreamCallback = (body: { message: string; done: boolean }) => void;

export type QueryOptions = {
  callTools?: (name: string, args: Record<string, any>) => Promise<CallToolResult>;
  streamCallback?: StreamCallback;
} & (ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming);
