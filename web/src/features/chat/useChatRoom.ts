import React from 'react';
import { ChatRoom } from 'amazon-ivs-chat-messaging';

const API_BASE_URL = (window as any).APP_CONFIG?.apiBaseUrl || '';

interface UseChatRoomProps {
  sessionId: string;
  authToken: string;
}

interface UseChatRoomReturn {
  room: ChatRoom;
  connectionState: 'disconnected' | 'connecting' | 'connected';
  error: string | null;
}

export const useChatRoom = ({ sessionId, authToken }: UseChatRoomProps): UseChatRoomReturn => {
  const [connectionState, setConnectionState] = React.useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [error, setError] = React.useState<string | null>(null);

  // Create tokenProvider callback that fetches from backend
  const tokenProvider = React.useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await response.json();
    return data.token;
  }, [sessionId, authToken]);

  // Initialize ChatRoom instance ONCE using useState with initializer
  const [room] = React.useState(() => new ChatRoom({
    regionOrUrl: 'us-east-1', // Match CDK stack region
    tokenProvider,
  }));

  // Track connectionState with listeners and connect
  React.useEffect(() => {
    const unsubscribeConnecting = room.addListener('connecting', () => {
      setConnectionState('connecting');
      setError(null);
    });

    const unsubscribeConnect = room.addListener('connect', () => {
      setConnectionState('connected');
      setError(null);
    });

    const unsubscribeDisconnect = room.addListener('disconnect', (event: any) => {
      setConnectionState('disconnected');
      if (event?.reason) {
        setError(event.reason);
      }
    });

    // Connect on mount
    room.connect();

    // Cleanup on unmount
    return () => {
      unsubscribeConnecting();
      unsubscribeConnect();
      unsubscribeDisconnect();
      room.disconnect();
    };
  }, [room]);

  return { room, connectionState, error };
};
