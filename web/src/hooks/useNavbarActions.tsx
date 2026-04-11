import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { fetchToken } from '../auth/fetchToken';
import { getConfig } from '../config/aws-config';

export function useNavbarActions() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const handleCreateBroadcast = async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    setIsCreating(true);
    try {
      const { token } = await fetchToken();
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionType: 'BROADCAST' }),
      });
      if (!response.ok) throw new Error(`Failed to create broadcast: ${response.status}`);
      const data = await response.json();
      navigate(`/broadcast/${data.sessionId}`, { state: { session: data } });
    } catch (error) {
      console.error('Failed to create broadcast:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateHangout = async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    setIsCreating(true);
    try {
      const { token } = await fetchToken();
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionType: 'HANGOUT' }),
      });
      if (!response.ok) throw new Error(`Failed to create hangout: ${response.status}`);
      const data = await response.json();
      navigate(`/hangout/${data.sessionId}`, { state: { session: data } });
    } catch (error) {
      console.error('Failed to create hangout:', error);
    } finally {
      setIsCreating(false);
    }
  };

  return {
    user,
    isCreating,
    handleSignOut,
    handleCreateBroadcast,
    handleCreateHangout,
  };
}
