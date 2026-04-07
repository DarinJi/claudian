const mockStatSync = jest.fn();

jest.mock('fs', () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

import { resolveCopilotContextAddDirs } from '@/providers/copilot/runtime/copilotAcpSupport';

describe('resolveCopilotContextAddDirs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts absolute file paths into unique parent directories and skips vault-local paths', () => {
    mockStatSync.mockImplementation((input: string) => ({
      isDirectory: () => input === '/external/dir',
    }));

    expect(resolveCopilotContextAddDirs('/vault', [
      'notes/file.md',
      '/external/doc-a.md',
      '/external/doc-b.md',
      '/external/dir',
      '/vault/note.md',
      '/external/doc-a.md',
    ])).toEqual([
      '/external',
      '/external/dir',
    ]);
  });

  it('falls back to dirname when stat fails', () => {
    mockStatSync.mockImplementation(() => {
      throw new Error('missing');
    });

    expect(resolveCopilotContextAddDirs('/vault', ['/outside/path/context.md'])).toEqual(['/outside/path']);
  });
});