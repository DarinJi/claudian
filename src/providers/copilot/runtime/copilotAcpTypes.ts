export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface CopilotAcpContentBlock {
  type?: string;
  text?: string;
}

export interface CopilotAcpPromptModelOption {
  modelId: string;
  name?: string;
  description?: string;
  _meta?: Record<string, unknown>;
}

export interface CopilotAcpSessionModelsState {
  availableModels?: CopilotAcpPromptModelOption[];
  currentModelId?: string;
}

export interface CopilotAcpModeOption {
  id: string;
  name?: string;
  description?: string;
}

export interface CopilotAcpSessionModesState {
  availableModes?: CopilotAcpModeOption[];
  currentModeId?: string;
}

export interface CopilotAcpSessionConfigOption {
  type?: string;
  id: string;
  name?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value: string; name?: string }>;
}

export interface CopilotAcpListedSession {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
}

export interface CopilotAcpListSessionsResponse {
  sessions?: CopilotAcpListedSession[];
}

export interface CopilotAcpNewSessionResponse {
  sessionId: string;
  models?: CopilotAcpSessionModelsState;
  modes?: CopilotAcpSessionModesState;
  configOptions?: CopilotAcpSessionConfigOption[];
  _meta?: Record<string, unknown>;
}

export interface CopilotAcpLoadSessionResponse {
  models?: CopilotAcpSessionModelsState;
  modes?: CopilotAcpSessionModesState;
  configOptions?: CopilotAcpSessionConfigOption[];
  _meta?: Record<string, unknown>;
}

export interface CopilotAcpPromptResponse {
  stopReason?: string;
}

export interface CopilotAcpSetModeResponse {
  modes?: CopilotAcpSessionModesState;
  configOptions?: CopilotAcpSessionConfigOption[];
}

export interface CopilotAcpSetConfigOptionResponse {
  models?: CopilotAcpSessionModelsState;
  configOptions?: CopilotAcpSessionConfigOption[];
}

export interface CopilotAcpToolCallLocation {
  path?: string;
}

export interface CopilotAcpToolCallUpdateContentEntry {
  type?: string;
  content?: CopilotAcpContentBlock;
}

export type CopilotAcpSessionUpdate =
  | {
      sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk';
      content?: CopilotAcpContentBlock;
    }
  | {
      sessionUpdate: 'tool_call';
      toolCallId: string;
      title?: string;
      kind?: string;
      status?: string;
      rawInput?: Record<string, unknown>;
      locations?: CopilotAcpToolCallLocation[];
    }
  | {
      sessionUpdate: 'tool_call_update';
      toolCallId: string;
      status?: string;
      content?: CopilotAcpToolCallUpdateContentEntry[];
      rawOutput?: {
        content?: string;
        detailedContent?: string;
      };
    }
  | {
      sessionUpdate:
        | 'usage_update'
        | 'available_commands_update'
        | 'current_mode_update'
        | 'config_option_update'
        | 'session_info_update'
        | 'plan'
        | (string & {});
      [key: string]: unknown;
    };

export interface CopilotAcpSessionUpdateNotification {
  sessionId: string;
  update: CopilotAcpSessionUpdate;
}

export interface CopilotAcpAgentInfo {
  name: string;
  title?: string;
  version?: string;
}

export interface CopilotAcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    sessionCapabilities?: Record<string, unknown>;
  };
  agentInfo?: CopilotAcpAgentInfo;
  authMethods?: Array<{
    id: string;
    name: string;
    description?: string;
    _meta?: Record<string, unknown>;
  }>;
}