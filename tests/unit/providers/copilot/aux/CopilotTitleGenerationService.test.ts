import '@/providers';

import { CopilotTitleGenerationService } from '@/providers/copilot/aux/CopilotTitleGenerationService';
import { CopilotAuxQueryRunner } from '@/providers/copilot/runtime/CopilotAuxQueryRunner';

jest.mock('@/providers/copilot/runtime/CopilotAuxQueryRunner');

const MockRunner = CopilotAuxQueryRunner as jest.MockedClass<typeof CopilotAuxQueryRunner>;

function createMockPlugin() {
  return {
    settings: {
      titleGenerationModel: '',
    },
  } as never;
}

describe('CopilotTitleGenerationService', () => {
  let service: CopilotTitleGenerationService;
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

    service = new CopilotTitleGenerationService(createMockPlugin());
  });

  it('uses the provider response as the generated title', async () => {
    mockQuery.mockResolvedValue('Fix Copilot inline edit');
    const callback = jest.fn().mockResolvedValue(undefined);

    await service.generateTitle('conv-1', 'please fix inline edit', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'Fix Copilot inline edit',
    });
    expect(mockReset).toHaveBeenCalled();
  });
});