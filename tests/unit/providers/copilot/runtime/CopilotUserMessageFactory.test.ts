import { buildCopilotAcpPromptContent } from '@/providers/copilot/runtime/CopilotUserMessageFactory';

describe('CopilotUserMessageFactory', () => {
  it('builds flat Copilot ACP image blocks with mimeType and data', () => {
    expect(buildCopilotAcpPromptContent('Describe this image', [{
      id: 'img-1',
      name: 'pixel.png',
      mediaType: 'image/png',
      data: 'ZmFrZS1pbWFnZQ==',
      size: 10,
      source: 'paste',
    }])).toEqual([
      {
        type: 'text',
        text: 'Describe this image',
      },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
      },
    ]);
  });

  it('keeps image-only turns when the prompt is empty', () => {
    expect(buildCopilotAcpPromptContent('', [{
      id: 'img-1',
      name: 'pixel.png',
      mediaType: 'image/png',
      data: 'ZmFrZS1pbWFnZQ==',
      size: 10,
      source: 'drop',
    }])).toEqual([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
      },
    ]);
  });

  it('preserves data URLs without double-prefixing them', () => {
    expect(buildCopilotAcpPromptContent('Describe this image', [{
      id: 'img-1',
      name: 'pixel.png',
      mediaType: 'image/png',
      data: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
      size: 10,
      source: 'file',
    }])).toEqual([
      {
        type: 'text',
        text: 'Describe this image',
      },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
      },
    ]);
  });
});