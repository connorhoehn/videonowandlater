import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getConfig } from '../config/aws-config';
import { RecordingFeed, type Recording } from '../features/replay/RecordingFeed';

export function HomePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);

  // Fetch recordings on mount
  useEffect(() => {
    const fetchRecordings = async () => {
      const config = getConfig();
      if (!config?.apiUrl) {
        console.error('API URL not configured');
        setLoadingRecordings(false);
        return;
      }

      try {
        const response = await fetch(`${config.apiUrl}/recordings`);
        if (!response.ok) {
          throw new Error(`Failed to fetch recordings: ${response.status}`);
        }
        const data = await response.json();
        setRecordings(data.recordings || []);
      } catch (err) {
        console.error('Error fetching recordings:', err);
      } finally {
        setLoadingRecordings(false);
      }
    };

    fetchRecordings();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleCreateBroadcast = async () => {
    const config = getConfig();
    if (!config?.apiUrl) {
      setError('Configuration not loaded');
      return;
    }

    setIsCreating(true);
    setError(''); // Clear previous errors per user decision

    try {
      const authToken = localStorage.getItem('token') || '';
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const sessionData = await response.json();

      // Navigate with state to avoid redundant fetch (per user decision)
      navigate(`/broadcast/${sessionData.sessionId}`, {
        state: { session: sessionData }
      });
    } catch (err) {
      setError('Failed to create session. Try again.'); // Exact wording per user decision
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Get Started Section */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        paddingTop: '4rem',
      }}>
        <div style={{
          maxWidth: '600px',
          width: '100%',
          backgroundColor: 'white',
          padding: '2rem',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          textAlign: 'center',
        }}>
          <h1 style={{ marginBottom: '1rem' }}>Welcome, {user?.username}!</h1>

          <button
            onClick={handleCreateBroadcast}
            disabled={isCreating}
            style={{
              padding: '0.75rem 2rem',
              backgroundColor: isCreating ? '#9e9e9e' : '#1976d2', // Blue for primary action
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: isCreating ? 'not-allowed' : 'pointer',
              marginBottom: '1rem',
            }}
          >
            {isCreating ? 'Creating...' : 'Create Broadcast'}
          </button>

          {error && (
            <p style={{ color: '#d32f2f', fontSize: '0.875rem', marginBottom: '1rem' }}>
              {error}
            </p>
          )}

          <button
            onClick={handleSignOut}
            style={{
              padding: '0.75rem 2rem',
              backgroundColor: '#d32f2f',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Recently Recorded Sessions */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem 0',
      }}>
        <h2 style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          marginBottom: '1rem',
          paddingLeft: '1rem',
        }}>
          Recently Recorded Sessions
        </h2>
        {loadingRecordings ? (
          <div style={{
            textAlign: 'center',
            padding: '2rem',
            color: '#666',
          }}>
            Loading recordings...
          </div>
        ) : (
          <RecordingFeed recordings={recordings} />
        )}
      </div>
    </div>
  );
}
