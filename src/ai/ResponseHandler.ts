import type { AIQueryResult } from '../types.js';
import { IntentParser } from './IntentParser.js';

export class ResponseHandler {
  constructor(private readonly intentParser: IntentParser) {}

  processResponse(response: string, context: string): AIQueryResult {
    const highlightedNodeIds = this.intentParser.extractReferencedNodeIds(response);
    return {
      answer: response,
      highlightedNodeIds,
      context,
    };
  }
}
