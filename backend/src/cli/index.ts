#!/usr/bin/env node
/**
 * VideoNowAndLater Developer CLI
 * Main entry point for CLI commands
 */

import { Command } from 'commander';
import { streamBroadcast } from './commands/stream-broadcast';
import { streamHangout } from './commands/stream-hangout';
import { seedSessions } from './commands/seed-sessions';
import { seedChat } from './commands/seed-chat';
import { seedReactions } from './commands/seed-reactions';
import { simulatePresence } from './commands/simulate-presence';
import { dlqList } from './commands/dlq-list';
import { dlqRedrive } from './commands/dlq-redrive';
import { dlqPurge } from './commands/dlq-purge';
import { dlqHealth } from './commands/dlq-health';

export const program = new Command();

program
  .name('vnl-cli')
  .description('VideoNowAndLater developer CLI')
  .version('1.1.0');

// Register commands
program
  .command('stream-broadcast')
  .description('Stream MP4/MOV file into active broadcast session')
  .argument('<session-id>', 'Session ID to stream into')
  .argument('<video-file>', 'Path to MP4/MOV file')
  .option('--loop', 'Loop video indefinitely', false)
  .action(streamBroadcast);

program
  .command('stream-hangout')
  .description('Stream MP4/MOV file into active hangout session')
  .argument('<session-id>', 'Session ID to stream into')
  .argument('<video-file>', 'Path to MP4/MOV file')
  .action(streamHangout);

program
  .command('seed-sessions')
  .description('Create sample broadcast and hangout sessions')
  .option('-n, --count <number>', 'Number of sessions', '5')
  .action(seedSessions);

program
  .command('seed-chat')
  .description('Seed sample chat messages for testing replay')
  .argument('<session-id>', 'Session ID to seed chat for')
  .option('-n, --count <number>', 'Number of messages', '20')
  .action(seedChat);

program
  .command('seed-reactions')
  .description('Seed sample reactions for testing timeline')
  .argument('<session-id>', 'Session ID to seed reactions for')
  .option('-n, --count <number>', 'Number of reactions', '50')
  .option('--replay', 'Mark as replay reactions', false)
  .action(seedReactions);

program
  .command('simulate-presence')
  .description('Simulate presence/viewer activity for testing')
  .argument('<session-id>', 'Session ID to send presence event')
  .option('-v, --viewers <number>', 'Number of viewers to simulate', '10')
  .action(simulatePresence);

// DLQ management commands
program
  .command('dlq-list')
  .description('List messages in a pipeline DLQ with decoded session context')
  .argument('<queue-url>', 'Full SQS queue URL of the DLQ')
  .action(dlqList);

program
  .command('dlq-redrive')
  .description('Re-drive all messages from a DLQ back to its source queue')
  .argument('<dlq-arn>', 'ARN of the DLQ to re-drive')
  .action(dlqRedrive);

program
  .command('dlq-purge')
  .description('Delete a specific DLQ message by receipt handle')
  .argument('<queue-url>', 'Full SQS queue URL of the DLQ')
  .argument('<receipt-handle>', 'ReceiptHandle from dlq-list output')
  .action((queueUrl: string, receiptHandle: string) => dlqPurge(queueUrl, receiptHandle));

program
  .command('dlq-health')
  .description('Report approximate message count for all 5 pipeline DLQs')
  .action(dlqHealth);

// Only parse if this is the main module (not imported for testing)
if (require.main === module) {
  program.parse();
}
