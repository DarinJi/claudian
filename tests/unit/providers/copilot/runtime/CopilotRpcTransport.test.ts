import { Readable, Writable } from 'stream';

import type { CopilotCliProcess } from '@/providers/copilot/runtime/CopilotCliProcess';
import { CopilotRpcTransport } from '@/providers/copilot/runtime/CopilotRpcTransport';

function createMockProcess(): CopilotCliProcess & {
  _stdout: Readable;
  _written: string[];
  _pushLine: (json: unknown) => void;
} {
  const stdout = new Readable({ read() {} });
  const written: string[] = [];
  const stdin = new Writable({
    write(chunk, _enc, callback) {
      written.push(chunk.toString());
      callback();
    },
  });

  return {
    stdin,
    stdout,
    stderr: new Readable({ read() {} }),
    isAlive: jest.fn().mockReturnValue(true),
    onExit: jest.fn(),
    onError: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    _stdout: stdout,
    _written: written,
    _pushLine(json: unknown) {
      stdout.push(JSON.stringify(json) + '\n');
    },
  } as unknown as CopilotCliProcess & {
    _stdout: Readable;
    _written: string[];
    _pushLine: (json: unknown) => void;
  };
}

describe('CopilotRpcTransport', () => {
  let proc: ReturnType<typeof createMockProcess>;
  let transport: CopilotRpcTransport;

  beforeEach(() => {
    proc = createMockProcess();
    transport = new CopilotRpcTransport(proc);
    transport.start();
  });

  afterEach(() => {
    transport.dispose();
  });

  it('resolves responses for matching requests', async () => {
    const promise = transport.request('initialize', { protocolVersion: 1 });

    const sent = JSON.parse(proc._written[0]);
    proc._pushLine({ jsonrpc: '2.0', id: sent.id, result: { protocolVersion: 1 } });

    await expect(promise).resolves.toEqual({ protocolVersion: 1 });
  });

  it('routes notifications to registered handlers', async () => {
    const handler = jest.fn();
    transport.onNotification('session/updated', handler);

    proc._pushLine({ jsonrpc: '2.0', method: 'session/updated', params: { id: 'abc' } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handler).toHaveBeenCalledWith({ id: 'abc' });
  });

  it('answers server-initiated requests', async () => {
    const handler = jest.fn().mockResolvedValue({ decision: 'accept' });
    transport.onServerRequest('permissions/request', handler);

    proc._pushLine({
      jsonrpc: '2.0',
      id: 7,
      method: 'permissions/request',
      params: { tool: 'read_file' },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith(7, { tool: 'read_file' });
    expect(proc._written.some((line) => {
      const parsed = JSON.parse(line);
      return parsed.id === 7 && parsed.result?.decision === 'accept';
    })).toBe(true);
  });
});