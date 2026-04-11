import React from 'react';
import { ChatRoom } from 'amazon-ivs-chat-messaging';
import { getConfig } from '../../config/aws-config';

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

  // Store the latest authToken in a ref so the tokenProvider closure (which is
  // captured once by ChatRoom) always uses the current value, even after the
  // Cognito session resolves and authToken changes from '' to a real JWT.
  const authTokenRef = React.useRef(authToken);
  React.useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const sessionIdRef = React.useRef(sessionId);
  React.useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // tokenProvider is defined once; it reads from refs so it always has current values.
  const tokenProvider = React.useCallback(async () => {
    const apiBaseUrl = getConfig()?.apiUrl || '';
    const response = await fetch(`${apiBaseUrl}/sessions/${sessionIdRef.current}/chat/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authTokenRef.current}` },
    });
    if (!response.ok) {
      throw new Error(`Chat token request failed: ${response.status}`);
    }
    const data = await response.json();
    return data;
  }, []); // no deps — reads via refs

  // Initialize ChatRoom instance ONCE using useState with initializer
  const [room] = React.useState(() => new ChatRoom({
    regionOrUrl: 'us-east-1', // Match CDK stack region
    tokenProvider,
  }));

  // Track connectionState with listeners and connect
  React.useEffect(() => {
    // Wait for a real auth token before connecting — the hook is called before
    // the HangoutPage auth guard, so authToken may still be '' on first render.
    if (!authToken) return;

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

    room.connect();

    return () => {
      unsubscribeConnecting();
      unsubscribeConnect();
      unsubscribeDisconnect();
      room.disconnect();
    };
  }, [room, authToken]);

  return { room, connectionState, error };
};
