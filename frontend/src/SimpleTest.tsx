import { useState, useEffect } from 'react';

function SimpleApp() {
  const [message, setMessage] = useState('Loading...');

  useEffect(() => {
    setTimeout(() => {
      setMessage('Hello from React!');
    }, 1000);
  }, []);

  return (
    <div style={{ padding: '20px', color: 'white' }}>
      <h1>{message}</h1>
      <p>This is a simple test component.</p>
    </div>
  );
}

export default SimpleApp;
