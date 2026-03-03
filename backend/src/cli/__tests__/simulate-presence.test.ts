/**
 * Tests for simulate-presence command
 */

import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { simulatePresence } from '../commands/simulate-presence';
import { getSessionById } from '../../repositories/session-repository';
import { getIVSChatClient } from '../../lib/ivs-clients';
import type { Session } from '../../domain/session';

// Mock dependencies
jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ivs-clients');

const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;
const mockGetIVSChatClient = getIVSChatClient as jest.MockedFunction<typeof getIVSChatClient>;

describe('simulate-presence command', () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';

    // Mock IVS Chat client send method
    mockSend = jest.fn().mockResolvedValue({});
    mockGetIVSChatClient.mockReturnValue({
      send: mockSend,
    } as any);

    jest.clearAllMocks();
  });

  it('should fetch session and extract chatRoom ARN', async () => {
    const mockSession: Session = {
      sessionId: 'test-session-123',
      userId: 'user-123',
      sessionType: 'BROADCAST' as any,
      status: 'live' as any,
      claimedResources: {
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789:room/chatroom123',
      },
      createdAt: '2026-03-03T10:00:00Z',
      version: 1,
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    await simulatePresence('test-session-123', { viewers: '10' });

    expect(mockGetSessionById).toHaveBeenCalledWith('test-table', 'test-session-123');
  });

  it('should call SendEventCommand with presence:update event', async () => {
    const mockSession: Session = {
      sessionId: 'test-session-123',
      userId: 'user-123',
      sessionType: 'BROADCAST' as any,
      status: 'live' as any,
      claimedResources: {
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789:room/chatroom123',
      },
      createdAt: '2026-03-03T10:00:00Z',
      version: 1,
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    await simulatePresence('test-session-123', { viewers: '10' });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sendCall = mockSend.mock.calls[0][0];
    expect(sendCall).toBeInstanceOf(SendEventCommand);
  });

  it('should include viewerCount and timestamp in event attributes', async () => {
    const mockSession: Session = {
      sessionId: 'test-session-123',
      userId: 'user-123',
      sessionType: 'BROADCAST' as any,
      status: 'live' as any,
      claimedResources: {
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789:room/chatroom123',
      },
      createdAt: '2026-03-03T10:00:00Z',
      version: 1,
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    await simulatePresence('test-session-123', { viewers: '42' });

    const sendCall = mockSend.mock.calls[0][0];
    const commandInput = sendCall.input;

    expect(commandInput.roomIdentifier).toBe('arn:aws:ivschat:us-east-1:123456789:room/chatroom123');
    expect(commandInput.eventName).toBe('presence:update');
    expect(commandInput.attributes).toHaveProperty('viewerCount', '42');
    expect(commandInput.attributes).toHaveProperty('timestamp');
    expect(commandInput.attributes.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should throw error if session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);

    await expect(
      simulatePresence('nonexistent-session', { viewers: '10' })
    ).rejects.toThrow('Session nonexistent-session not found');

    expect(mockSend).not.toHaveBeenCalled();
  });
});
