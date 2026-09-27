import { describe, it, expect } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import { RateLimiter, DEFAULT_RATE_LIMITS } from '../src/utils/rate-limiter';
import { ReviewReportSchema } from '../src/types/report-types';

/**
 * Tests for CodeReviewOrchestrator
 */

describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
    });

    it('should accept custom rate limit configuration', () => {
      const customRateLimiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 5000,
        maxConcurrent: 2
      });

      const orchestrator = new CodeReviewOrchestrator({
        rateLimiter: customRateLimiter,
        maxTurns: 20,
        timeoutMs: 60000
      });

      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
    });
  });

  describe('ReviewReport Schema Validation', () => {
    it('should validate a well-formed ReviewReport', () => {
      const validReport = {
        pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
        fileReviews: [
          {
            file: 'src/index.ts',
            codeQuality: {
              file: 'src/index.ts',
              issues: [
                {
                  line: 12,
                  severity: 'medium',
                  category: 'maintainability',
                  description: 'Function too long',
                  suggestion: 'Split into smaller functions'
                }
              ],
              overallScore: 80,
              summary: 'Generally clean code'
            },
            testCoverage: {
              file: 'src/index.ts',
              hasTests: true,
              testFiles: ['src/index.test.ts'],
              untestedPaths: [
                {
                  type: 'function',
                  location: 'src/index.ts:20',
                  priority: 'medium',
                  reasoning: 'Edge case not covered',
                  suggestedTest: 'Test with empty input'
                }
              ],
              coverageEstimate: 75,
              summary: 'Good coverage overall'
            },
            refactorings: {
              file: 'src/index.ts',
              suggestions: [
                {
                  type: 'extract-function',
                  location: 'src/index.ts:15',
                  impact: 'low',
                  description: 'Extract validation logic',
                  before: 'inline code',
                  after: 'extracted function',
                  benefits: 'Improved readability'
                }
              ],
              summary: 'Minor improvements possible'
            }
          }
        ],
        summary: {
          totalFiles: 1,
          overallScore: 80,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 1
        },
        recommendations: [
          {
            priority: 'medium',
            category: 'maintainability',
            description: 'Consider splitting large functions',
            files: ['src/index.ts']
          }
        ],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 15000,
          agentVersions: {
            'code-quality-analyzer': '1.0.0',
            'test-coverage-analyzer': '1.0.0',
            'refactoring-suggester': '1.0.0'
          }
        }
      };

      const result = ReviewReportSchema.safeParse(validReport);
      expect(result.success).toBe(true);
    });

    it('should reject a ReviewReport missing required fields', () => {
      const invalidReport = {
        pullRequest: { owner: 'octocat' }
      };

      const result = ReviewReportSchema.safeParse(invalidReport);
      expect(result.success).toBe(false);
    });

    it('should accept an empty fileReviews array (edge case)', () => {
      const emptyFilesReport = {
        pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 100,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 100,
          agentVersions: {}
        }
      };

      const result = ReviewReportSchema.safeParse(emptyFilesReport);
      expect(result.success).toBe(true);
    });

    it('should accept boundary score values (0 and 100)', () => {
      const boundaryReport = {
        pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 0,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 0,
          agentVersions: {}
        }
      };

      expect(ReviewReportSchema.safeParse(boundaryReport).success).toBe(true);

      const boundaryReportMax = {
        ...boundaryReport,
        summary: { ...boundaryReport.summary, overallScore: 100 }
      };
      expect(ReviewReportSchema.safeParse(boundaryReportMax).success).toBe(true);
    });

    it('should reject invalid recommendation priority enum values', () => {
      const invalidPriority = {
        pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 100,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [
          {
            priority: 'super-urgent', // invalid enum value
            category: 'test',
            description: 'test',
            files: []
          }
        ],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 100,
          agentVersions: {}
        }
      };

      const result = ReviewReportSchema.safeParse(invalidPriority);
      expect(result.success).toBe(false);
    });
  });

  describe('Integration', () => {
    // Requires real API keys; run manually with `npm test -- --run tests/orchestrator.test.ts -t Integration`
    it.skip('should review a real small PR (octocat/Hello-World #1)', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      expect(report.pullRequest.owner).toBe('octocat');
      expect(report.pullRequest.repo).toBe('Hello-World');
      expect(report.summary.overallScore).toBeGreaterThanOrEqual(0);

      const validation = ReviewReportSchema.safeParse(report);
      expect(validation.success).toBe(true);
    }, 5 * 60 * 1000);
  });
});
