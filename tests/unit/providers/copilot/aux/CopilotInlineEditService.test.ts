import { CopilotInlineEditService } from '@/providers/copilot/aux/CopilotInlineEditService';
import { CopilotAuxQueryRunner } from '@/providers/copilot/runtime/CopilotAuxQueryRunner';

jest.mock('@/providers/copilot/runtime/CopilotAuxQueryRunner');

const MockRunner = CopilotAuxQueryRunner as jest.MockedClass<typeof CopilotAuxQueryRunner>;

function createMockPlugin() {
  return { settings: {} } as never;
}

describe('CopilotInlineEditService', () => {
  let service: CopilotInlineEditService;
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

    service = new CopilotInlineEditService(createMockPlugin());
  });

  it('parses replacement responses', async () => {
    mockQuery.mockResolvedValue('<replacement>updated text</replacement>');

    const result = await service.editText({
      mode: 'selection',
      instruction: 'improve this',
      notePath: 'notes/test.md',
      selectedText: 'old text',
    });

    expect(result.success).toBe(true);
    expect(result.editedText).toBe('updated text');
  });

  it('requires an active conversation for follow-up turns', async () => {
    const result = await service.continueConversation('follow up');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No active conversation to continue');
  });
});