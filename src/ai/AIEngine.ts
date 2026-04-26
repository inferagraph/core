import type { AIQueryResult, LLMCompletionRequest, LLMStreamChunk } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import { LLMProvider } from './LLMProvider.js';
import { ContextBuilder } from './ContextBuilder.js';
import type { ContextBuilderConfig } from './ContextBuilder.js';
import { IntentParser } from './IntentParser.js';
import type { IntentParserConfig } from './IntentParser.js';
import { ResponseHandler } from './ResponseHandler.js';

export interface AIEngineConfig {
  /** System prompt for LLM queries. Default is a generic graph assistant prompt. */
  systemPrompt?: string;
  /** Configuration for the context builder */
  contextBuilder?: Partial<ContextBuilderConfig>;
  /** Configuration for the intent parser */
  intentParser?: Partial<IntentParserConfig>;
}

export class AIEngine {
  private config: Required<Pick<AIEngineConfig, 'systemPrompt'>>;
  private provider: LLMProvider | null = null;
  private readonly contextBuilder: ContextBuilder;
  private readonly responseHandler: ResponseHandler;

  constructor(
    store: GraphStore,
    queryEngine: QueryEngine,
    config?: AIEngineConfig,
  ) {
    this.config = {
      systemPrompt:
        config?.systemPrompt ??
        'You are a knowledgeable assistant. Answer questions using the following graph data as context:',
    };
    this.contextBuilder = new ContextBuilder(store, queryEngine, config?.contextBuilder);
    const intentParser = new IntentParser(store, config?.intentParser);
    this.responseHandler = new ResponseHandler(intentParser);
  }

  configure(config: Partial<AIEngineConfig>): void {
    if (config.systemPrompt !== undefined) {
      this.config.systemPrompt = config.systemPrompt;
    }
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  getProvider(): LLMProvider | null {
    return this.provider;
  }

  async query(question: string): Promise<AIQueryResult> {
    if (!this.provider) {
      throw new Error('No LLM provider configured. Call setProvider() first.');
    }

    const context = this.contextBuilder.buildContextForQuery(question);
    const response = await this.provider.complete({
      messages: [
        {
          role: 'system',
          content: `${this.config.systemPrompt}\n\n${context}`,
        },
        { role: 'user', content: question },
      ],
      maxTokens: 1024,
    });

    return this.responseHandler.processResponse(response.content, context);
  }

  async *queryStream(question: string): AsyncIterable<LLMStreamChunk> {
    if (!this.provider) {
      throw new Error('No LLM provider configured. Call setProvider() first.');
    }

    const context = this.contextBuilder.buildContextForQuery(question);
    const request: LLMCompletionRequest = {
      messages: [
        {
          role: 'system',
          content: `${this.config.systemPrompt}\n\n${context}`,
        },
        { role: 'user', content: question },
      ],
      maxTokens: 1024,
    };

    yield* this.provider.stream(request);
  }
}
