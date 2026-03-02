import { SessionStatus, SessionType, Session, canTransition } from '../session';
import { ResourcePoolItem, Status, ResourceType } from '../resource-pool';

describe('Session Domain Model', () => {
  describe('SessionStatus enum', () => {
    it('should export creating, live, ending, ended values', () => {
      expect(SessionStatus.CREATING).toBe('creating');
      expect(SessionStatus.LIVE).toBe('live');
      expect(SessionStatus.ENDING).toBe('ending');
      expect(SessionStatus.ENDED).toBe('ended');
    });
  });

  describe('canTransition function', () => {
    it('should return true for valid transitions', () => {
      expect(canTransition(SessionStatus.CREATING, SessionStatus.LIVE)).toBe(true);
      expect(canTransition(SessionStatus.LIVE, SessionStatus.ENDING)).toBe(true);
      expect(canTransition(SessionStatus.ENDING, SessionStatus.ENDED)).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(canTransition(SessionStatus.CREATING, SessionStatus.ENDING)).toBe(false);
      expect(canTransition(SessionStatus.CREATING, SessionStatus.ENDED)).toBe(false);
      expect(canTransition(SessionStatus.LIVE, SessionStatus.CREATING)).toBe(false);
      expect(canTransition(SessionStatus.LIVE, SessionStatus.ENDED)).toBe(false);
      expect(canTransition(SessionStatus.ENDING, SessionStatus.CREATING)).toBe(false);
      expect(canTransition(SessionStatus.ENDING, SessionStatus.LIVE)).toBe(false);
      expect(canTransition(SessionStatus.ENDED, SessionStatus.CREATING)).toBe(false);
      expect(canTransition(SessionStatus.ENDED, SessionStatus.LIVE)).toBe(false);
      expect(canTransition(SessionStatus.ENDED, SessionStatus.ENDING)).toBe(false);
    });
  });

  describe('SessionType enum', () => {
    it('should export BROADCAST and HANGOUT', () => {
      expect(SessionType.BROADCAST).toBe('BROADCAST');
      expect(SessionType.HANGOUT).toBe('HANGOUT');
    });
  });

  describe('Session interface', () => {
    it('should have required fields', () => {
      const session: Session = {
        sessionId: 'test-session-id',
        userId: 'test-user-id',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: 'room-id' },
        version: 1,
        createdAt: '2026-03-02T14:00:00.000Z',
      };

      expect(session.sessionId).toBe('test-session-id');
      expect(session.userId).toBe('test-user-id');
      expect(session.sessionType).toBe(SessionType.BROADCAST);
      expect(session.status).toBe(SessionStatus.CREATING);
      expect(session.claimedResources).toEqual({ chatRoom: 'room-id' });
      expect(session.version).toBe(1);
      expect(session.createdAt).toBe('2026-03-02T14:00:00.000Z');
    });
  });
});

describe('ResourcePool Domain Model', () => {
  describe('ResourcePoolItem interface', () => {
    it('should have required fields', () => {
      const item: ResourcePoolItem = {
        resourceType: ResourceType.CHANNEL,
        resourceArn: 'arn:aws:ivs:us-east-1:123456789012:channel/abcd',
        resourceId: 'abcd',
        status: Status.AVAILABLE,
        version: 1,
        createdAt: '2026-03-02T14:00:00.000Z',
        claimedAt: null,
        claimedBy: null,
      };

      expect(item.resourceType).toBe(ResourceType.CHANNEL);
      expect(item.resourceArn).toBe('arn:aws:ivs:us-east-1:123456789012:channel/abcd');
      expect(item.resourceId).toBe('abcd');
      expect(item.status).toBe(Status.AVAILABLE);
      expect(item.version).toBe(1);
      expect(item.createdAt).toBe('2026-03-02T14:00:00.000Z');
      expect(item.claimedAt).toBeNull();
      expect(item.claimedBy).toBeNull();
    });
  });

  describe('Status enum', () => {
    it('should export AVAILABLE, CLAIMED, ENDED', () => {
      expect(Status.AVAILABLE).toBe('AVAILABLE');
      expect(Status.CLAIMED).toBe('CLAIMED');
      expect(Status.ENDED).toBe('ENDED');
    });
  });

  describe('ResourceType enum', () => {
    it('should export CHANNEL, STAGE, ROOM', () => {
      expect(ResourceType.CHANNEL).toBe('CHANNEL');
      expect(ResourceType.STAGE).toBe('STAGE');
      expect(ResourceType.ROOM).toBe('ROOM');
    });
  });
});
