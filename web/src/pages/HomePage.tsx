import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export function HomePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '2rem',
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

        <p style={{ color: '#666', marginBottom: '2rem' }}>
          You are successfully logged in. Future phases will add session creation and management here.
        </p>

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
  );
}
