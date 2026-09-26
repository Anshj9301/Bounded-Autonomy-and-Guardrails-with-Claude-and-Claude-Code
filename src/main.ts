import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

import { CodeReviewOrchestrator } from './orchestrator';
import { ReportGenerator } from './utils/report-generator';
import { logger } from './utils/logger';

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // ── Validate command line arguments ──────────────────────────────
  if (!owner || !repo || !prStr) {
    console.error('❌ Missing required arguments.');
    console.error('Usage: npm run dev <owner> <repo> <pr-number>');
    console.error('Example: npm run dev octocat Hello-World 1');
    process.exit(1);
  }

  const prNumber = parseInt(prStr, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0 || String(prNumber) !== prStr) {
    console.error(`❌ Invalid PR number: "${prStr}". Must be a positive integer.`);
    process.exit(1);
  }

  // ── Validate authentication ──────────────────────────────────────
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasAwsCreds = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAwsCreds) {
    if (!process.env.AWS_REGION) {
      console.error('❌ AWS credentials found but AWS_REGION is not set.');
      console.error('Add AWS_REGION=<your-region> to your .env file.');
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else {
    console.error('❌ No authentication configured.');
    console.error('Set ONE of the following in your .env or environment:');
    console.error('  - ANTHROPIC_API_KEY=sk-ant-...');
    console.error('  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (for Bedrock)');
    process.exit(1);
  }

  // ── Validate ANTHROPIC_MODEL ──────────────────────────────────────
  if (!process.env.ANTHROPIC_MODEL) {
    console.error('❌ ANTHROPIC_MODEL environment variable is required.');
    if (hasAwsCreds) {
      console.error('For AWS Bedrock, example: ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    } else {
      console.error('For Anthropic API, example: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929');
    }
    process.exit(1);
  }

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const generator = new ReportGenerator();
    const jsonReport = generator.generateJSONReport(report);
    const mdReport = generator.generateMarkdownReport(report);
    const htmlReport = generator.generateHTMLReport(report);

    const outDir = path.join(process.cwd(), 'reports');
    fs.mkdirSync(outDir, { recursive: true });

    const baseName = `${owner}_${repo}_${prNumber}`;
    const jsonPath = path.join(outDir, `${baseName}.json`);
    const mdPath = path.join(outDir, `${baseName}.md`);
    const htmlPath = path.join(outDir, `${baseName}.html`);

    fs.writeFileSync(jsonPath, jsonReport, 'utf-8');
    fs.writeFileSync(mdPath, mdReport, 'utf-8');
    fs.writeFileSync(htmlPath, htmlReport, 'utf-8');

    console.log('✅ Review complete. Reports saved:');
    console.log(`   JSON:     reports/${baseName}.json`);
    console.log(`   Markdown: reports/${baseName}.md`);
    console.log(`   HTML:     reports/${baseName}.html`);
    console.log(`   Overall score: ${report.summary.overallScore}/100`);
  } catch (error) {
    logger.error('Fatal error during review', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();