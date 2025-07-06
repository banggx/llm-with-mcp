import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio";
import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse";

export type MCPServer =
  | {
    type: 'command',
    command: string;
    args: string[];
    opts?: Omit<StdioServerParameters, 'command' | 'args'>
  }
  | {
    type: 'sse',
    url: string;
    opts?: SSEClientTransportOptions;
  }

export interface MCPConfig {
  [key: string]: MCPServer;
}