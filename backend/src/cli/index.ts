#!/usr/bin/env node
/**
 * VideoNowAndLater Developer CLI
 * Main entry point for CLI commands
 */

import { Command } from 'commander';
import { streamBroadcast } from './commands/stream-broadcast';
import { streamHangout } from './commands/stream-hangout';

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

// Only parse if this is the main module (not imported for testing)
if (require.main === module) {
  program.parse();
}
