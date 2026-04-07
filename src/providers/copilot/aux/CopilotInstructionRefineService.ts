import type {
  InstructionRefineService,
  RefineProgressCallback,
} from '../../../core/providers/types';
import type { InstructionRefineResult } from '../../../core/types';

function buildResult(raw: string): InstructionRefineResult {
  const refinedInstruction = raw.replace(/\s+/g, ' ').trim();
  if (!refinedInstruction) {
    return { success: false, error: 'Instruction is empty.' };
  }

  return { success: true, refinedInstruction };
}

export class CopilotInstructionRefineService implements InstructionRefineService {
  resetConversation(): void {
    // No persistent state in the scaffold phase.
  }

  async refineInstruction(
    rawInstruction: string,
    _existingInstructions: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    const result = buildResult(rawInstruction);
    onProgress?.(result);
    return result;
  }

  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    const result = buildResult(message);
    onProgress?.(result);
    return result;
  }

  cancel(): void {
    // No-op for local refinement fallback.
  }
}