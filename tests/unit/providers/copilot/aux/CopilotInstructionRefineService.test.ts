import { CopilotInstructionRefineService } from '@/providers/copilot/aux/CopilotInstructionRefineService';
import { CopilotAuxQueryRunner } from '@/providers/copilot/runtime/CopilotAuxQueryRunner';

jest.mock('@/providers/copilot/runtime/CopilotAuxQueryRunner');

const MockRunner = CopilotAuxQueryRunner as jest.MockedClass<typeof CopilotAuxQueryRunner>;

function createMockPlugin() {
  return { settings: {} } as never;
}

describe('CopilotInstructionRefineService', () => {
  let service: CopilotInstructionRefineService;
  let mockQuery: jest.Mock;
  let mockReset: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = jest.fn();
    mockReset = jest.fn();
    MockRunner.mockImplementation(() => ({
      query: mockQuery,
      reset: mockReset,
    }) as unknown as CopilotAuxQueryRunner);

    service = new CopilotInstructionRefineService(createMockPlugin());
  });

  it('parses refined instruction from provider response', async () => {
    mockQuery.mockResolvedValue('<instruction>Use TypeScript</instruction>');

    const result = await service.refineInstruction('use ts', '');

    expect(result.success).toBe(true);
    expect(result.refinedInstruction).toBe('Use TypeScript');
  });

  it('allows follow-up conversation after the first turn', async () => {
    mockQuery.mockResolvedValue('Which language?');
    await service.refineInstruction('use typed language', '');

    mockQuery.mockResolvedValue('<instruction>Use TypeScript for code</instruction>');
    const result = await service.continueConversation('TypeScript');

    expect(result.success).toBe(true);
    expect(result.refinedInstruction).toBe('Use TypeScript for code');
  });

  it('returns an error when there is no active conversation', async () => {
    const result = await service.continueConversation('follow up');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No active conversation to continue');
  });
});