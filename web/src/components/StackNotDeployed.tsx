export function StackNotDeployed() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#f5f5f5',
    }}>
      <div style={{
        maxWidth: '600px',
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      }}>
        <h1 style={{ color: '#d32f2f', marginBottom: '1.5rem' }}>Stack Not Deployed</h1>

        <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
          The AWS CDK stack has not been deployed yet. Run the following commands to get started:
        </p>

        <div style={{
          backgroundColor: '#f5f5f5',
          padding: '1rem',
          borderRadius: '4px',
          marginBottom: '1rem',
        }}>
          <p style={{ margin: '0.5rem 0', fontWeight: 'bold' }}>Step 1: Deploy the stack</p>
          <code style={{
            display: 'block',
            padding: '0.5rem',
            backgroundColor: '#1e1e1e',
            color: '#d4d4d4',
            borderRadius: '4px',
            fontFamily: 'monospace',
            marginBottom: '1rem',
          }}>npm run deploy</code>

          <p style={{ margin: '0.5rem 0', fontWeight: 'bold' }}>Step 2: Refresh this page</p>
          <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#666' }}>
            After deployment completes, refresh the browser to load the configuration.
          </p>
        </div>

        <div style={{
          backgroundColor: '#fff3cd',
          padding: '1rem',
          borderRadius: '4px',
          border: '1px solid #ffc107',
        }}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Prerequisites:</h3>
          <ul style={{ marginBottom: 0, paddingLeft: '1.5rem', lineHeight: '1.8' }}>
            <li>AWS CLI configured with valid credentials</li>
            <li>CDK bootstrapped in your AWS account: <code style={{ backgroundColor: '#f5f5f5', padding: '2px 6px' }}>npx cdk bootstrap</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
