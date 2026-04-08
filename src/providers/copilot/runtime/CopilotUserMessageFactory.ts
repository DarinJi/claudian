import type { ImageAttachment } from '../../../core/types';

import type { CopilotAcpPromptContentBlock } from './copilotAcpTypes';

function toCopilotImageDataUrl(image: ImageAttachment): string {
  if (image.data.startsWith('data:')) {
    return image.data;
  }

  return `data:${image.mediaType};base64,${image.data}`;
}

export function buildCopilotAcpPromptContent(
  prompt: string,
  images?: ImageAttachment[],
): CopilotAcpPromptContentBlock[] {
  const content: CopilotAcpPromptContentBlock[] = [];

  if (prompt.trim()) {
    content.push({
      type: 'text',
      text: prompt,
    });
  }

  for (const image of images ?? []) {
    content.push({
      type: 'image',
      mimeType: image.mediaType,
      data: toCopilotImageDataUrl(image),
    });
  }

  return content;
}