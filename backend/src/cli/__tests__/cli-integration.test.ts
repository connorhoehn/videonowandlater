/**
 * CLI integration tests
 * Verifies command registration, help output, and version
 */

import { program } from '../index';

describe('CLI integration', () => {
  it('should export program with correct name and version', () => {
    expect(program.name()).toBe('vnl-cli');
    expect(program.version()).toBe('1.1.0');
  });

  it('should have all 6 commands registered', () => {
    const commands = program.commands.map(cmd => cmd.name());

    expect(commands).toContain('stream-broadcast');
    expect(commands).toContain('stream-hangout');
    expect(commands).toContain('seed-sessions');
    expect(commands).toContain('seed-chat');
    expect(commands).toContain('seed-reactions');
    expect(commands).toContain('simulate-presence');
    expect(commands.length).toBe(6);
  });

  it('should include descriptions for all commands', () => {
    const commandsWithDescriptions = program.commands.filter(cmd => cmd.description());

    expect(commandsWithDescriptions.length).toBe(6);

    // Verify specific command descriptions
    const streamBroadcast = program.commands.find(cmd => cmd.name() === 'stream-broadcast');
    expect(streamBroadcast?.description()).toContain('Stream MP4/MOV file');

    const simulatePresence = program.commands.find(cmd => cmd.name() === 'simulate-presence');
    expect(simulatePresence?.description()).toContain('presence/viewer activity');
  });

  it('should have help text available', () => {
    const helpText = program.helpInformation();

    expect(helpText).toContain('vnl-cli');
    expect(helpText).toContain('VideoNowAndLater developer CLI');
    expect(helpText).toContain('stream-broadcast');
    expect(helpText).toContain('stream-hangout');
    expect(helpText).toContain('seed-sessions');
    expect(helpText).toContain('seed-chat');
    expect(helpText).toContain('seed-reactions');
    expect(helpText).toContain('simulate-presence');
  });

  it('should have proper arguments and options for simulate-presence', () => {
    const simulatePresence = program.commands.find(cmd => cmd.name() === 'simulate-presence');

    expect(simulatePresence).toBeDefined();
    expect(simulatePresence?.registeredArguments.length).toBe(1);

    // Check for --viewers option
    const options = simulatePresence?.options;
    const viewersOption = options?.find(opt => opt.long === '--viewers');
    expect(viewersOption).toBeDefined();
    expect(viewersOption?.short).toBe('-v');
    expect(viewersOption?.defaultValue).toBe('10');
  });

  it('should have proper arguments and options for stream-broadcast', () => {
    const streamBroadcast = program.commands.find(cmd => cmd.name() === 'stream-broadcast');

    expect(streamBroadcast).toBeDefined();
    expect(streamBroadcast?.registeredArguments.length).toBe(2);

    // Check for --loop option
    const options = streamBroadcast?.options;
    const loopOption = options?.find(opt => opt.long === '--loop');
    expect(loopOption).toBeDefined();
  });
});
