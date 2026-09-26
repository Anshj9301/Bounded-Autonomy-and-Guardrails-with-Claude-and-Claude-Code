import { query } from '@anthropic-ai/claude-agent-sdk';
import { mcpServersConfig } from './config/mcp.config';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents';
import { buildOrchestratorPrompt } from './prompts';
import { ReviewReportSchema, ReviewReportJSONSchema, ReviewReport } from './types/report-types';
import { RateLimiter, DEFAULT_RATE_LIMITS } from './utils/rate-limiter';
import { withRetry, withTimeout, ReviewError, ErrorCodes } from './utils/error-handler';
import { logger, logReviewStart, logReviewComplete, logReviewError } from './utils/logger';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  maxTurns?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
}

/**
 * Named subagents, keyed by the exact name the orchestrator prompt
 * refers to (e.g. "Use the code-quality-analyzer agent to analyze <file>").
 */
const subagents = {
  'code-quality-analyzer': codeQualityAnalyzer,
  'test-coverage-analyzer': testCoverageAnalyzer,
  'refactoring-suggester': refactoringSuggester,
};

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.maxTurns = options.maxTurns ?? 40;
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000; // 10 minutes
    this.rateLimiter = options.rateLimiter ?? new RateLimiter(DEFAULT_RATE_LIMITS);
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const model = process.env.ANTHROPIC_MODEL;
    if (!model) {
      throw new ReviewError(
        'ANTHROPIC_MODEL environment variable is required',
        ErrorCodes.INVALID_CONFIG
      );
    }

    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    const estimatedTokens = 20000;
    await this.rateLimiter.acquire(estimatedTokens);

    try {
      const report = await withRetry(
        () => withTimeout(
          () => this.runQuery(owner, repo, prNumber, model),
          this.timeoutMs,
          `PR review timed out after ${this.timeoutMs}ms`
        ),
        3,
        1000
      );

      const duration = Date.now() - startedAt;
      report.metadata = {
        analyzedAt: new Date().toISOString(),
        duration,
        agentVersions: {
          'code-quality-analyzer': '1.0.0',
          'test-coverage-analyzer': '1.0.0',
          'refactoring-suggester': '1.0.0',
        },
      };

      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, duration);
      return report;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * Runs a single orchestrator query against the Claude Agent SDK,
   * spawning subagents and collecting the final structured output.
   */
  private async runQuery(
    owner: string,
    repo: string,
    prNumber: number,
    model: string
  ): Promise<ReviewReport> {
    const prompt = buildOrchestratorPrompt(owner, repo, prNumber);

    const stream = query({
      prompt,
      options: {
        model,
        maxTurns: this.maxTurns,
        permissionMode: 'bypassPermissions',
        mcpServers: mcpServersConfig,
        agents: subagents,
        allowedTools: [
          'Task',
          'Read',
          'Grep',
          'Glob',
          'Skill',
          'mcp__github',
          'mcp__eslint',
        ],
        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema,
        },
      },
    });

    let structuredOutput: unknown;

    for await (const event of stream as AsyncIterable<any>) {
      if (event?.type === 'result' && 'structured_output' in event) {
        structuredOutput = event.structured_output;
      }
      logger.debug('Agent SDK event', { type: event?.type });
    }

    if (structuredOutput === undefined) {
      throw new ReviewError(
        'Orchestrator query completed without producing a structured_output',
        ErrorCodes.STRUCTURED_OUTPUT_FAILED
      );
    }

    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      throw new ReviewError(
        `Structured output failed schema validation: ${parsed.error.message}`,
        ErrorCodes.VALIDATION_FAILED,
        { zodError: parsed.error.format() }
      );
    }

    return parsed.data;
  }
}