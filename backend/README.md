# Backend

VideoNowAndLater backend services: Lambda handlers, repositories, domain models, and developer CLI.

## Structure

```
backend/
├── src/
│   ├── cli/              # Developer CLI commands
│   ├── handlers/         # Lambda function handlers
│   ├── repositories/     # Data access layer
│   ├── domain/          # Domain models and business logic
│   └── lib/             # Shared utilities
├── dist/                # Compiled TypeScript output
└── package.json
```

## CLI Development

### Structure
- `src/cli/index.ts` - Commander.js entry point
- `src/cli/commands/` - Command implementations
- `src/cli/lib/` - Shared utilities (FFmpeg, config)
- `src/cli/__tests__/` - Unit and integration tests

### Building
```bash
npm run build  # Compiles TypeScript to dist/
```

### Testing
```bash
npm test -- backend/src/cli          # All CLI tests
npm test -- --watch                   # Watch mode
npm test -- stream-broadcast.test    # Specific test
```

### Adding New Commands
1. Create `src/cli/commands/my-command.ts` with exported async function
2. Add command registration in `src/cli/index.ts`:
   ```typescript
   program.command('my-command')
     .description('...')
     .argument('<arg>', '...')
     .action(myCommand);
   ```
3. Write tests in `src/cli/__tests__/my-command.test.ts`
4. Update scripts/README.md with usage examples

## Lambda Development

### Testing Lambda Handlers
```bash
npm test -- backend/src/handlers
```

### Local Development
Use AWS SAM or LocalStack for local Lambda execution.

## Domain Models

Core domain entities in `src/domain/`:
- `session.ts` - Session lifecycle and state machine
- `chat-message.ts` - Chat message with replay synchronization
- `reaction.ts` - Reaction with timeline positioning

## Deployment

Deployment is handled by CDK infrastructure in `/infrastructure` directory. Lambda functions are packaged and deployed automatically.
