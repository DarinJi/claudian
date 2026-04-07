export interface CopilotLaunchSpec {
  command: string;
  args: string[];
  spawnCwd: string;
  env: Record<string, string>;
}