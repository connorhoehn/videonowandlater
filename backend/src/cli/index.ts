#!/usr/bin/env node
/**
 * VideoNowAndLater Developer CLI
 * Main entry point for CLI commands
 */

import { Command } from 'commander';

export const program = new Command();

program
  .name('vnl-cli')
  .description('VideoNowAndLater developer CLI')
  .version('1.1.0');

// Commands will be registered here in subsequent tasks

// Only parse if this is the main module (not imported for testing)
if (require.main === module) {
  program.parse();
}
