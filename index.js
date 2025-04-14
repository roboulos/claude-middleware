const express = require('express');
const fetch = require('node-fetch');
const app = express();

const PORT = process.env.PORT || 3000;
const XANO_STREAM_URL = 'https://xnwv-v1z6-dvnr.n7c.xano.io/api:13ckfFnv/stream';
const XANO_JSONRPC_URL = 'https://xnwv-v1z6-dvnr.n7c.xano.io/api:13ckfFnv/jsonrpc';

// Parse JSON bodies
app.use(express.json());

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Main SSE endpoint - Keep existing functionality
app.get('/raw-sse', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Get session ID from query parameters
  const sessionId = req.query.id || 'test_session_123';
  const xanoUrl = `${XANO_STREAM_URL}?id=${sessionId}`;
  
  console.log(`Connecting to Xano SSE at: ${xanoUrl}`);
  
  try {
    // Connect to Xano's SSE endpoint
    const xanoResponse = await fetch(xanoUrl);
    
    if (!xanoResponse.ok) {
      console.error(`Xano returned error: ${xanoResponse.status}`);
      res.status(502).end(`Error connecting to Xano: ${xanoResponse.status}`);
      return;
    }
    
    console.log(`Connected to Xano SSE stream for session: ${sessionId}`);
    
    // Process each chunk as it arrives
    xanoResponse.body.on('data', (chunk) => {
      // Convert buffer to string
      const text = chunk.toString();
      
      // Process the chunk to extract only the JSON part
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          // Extract JSON and add double newline
          const jsonData = line.substring(6) + '\n\n';
          res.write(jsonData);
          console.log(`Forwarded message: ${jsonData.trim()}`);
        }
      }
    });

    // Handle end of stream
    xanoResponse.body.on('end', () => {
      console.log(`Stream ended for session: ${sessionId}`);
      res.end();
    });

    // Handle stream errors
    xanoResponse.body.on('error', (err) => {
      console.error(`Stream error for session ${sessionId}:`, err);
      res.end();
    });
  } catch (err) {
    console.error(`Connection error for session ${sessionId}:`, err);
    res.status(500).end('Server error');
  }
  
  // Handle client disconnect
  req.on('close', () => {
    console.log(`Client disconnected for session: ${sessionId}`);
  });
});

// Handle OPTIONS requests for CORS
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

// Add CORS headers to all responses
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Simple JSON-RPC proxy that modifies the ID field
app.post('/jsonrpc', async (req, res) => {
  try {
    console.log('Received JSON-RPC request:', JSON.stringify(req.body).substring(0, 200));
    
    // Get the session ID, using same logic as the SSE endpoint
    const sessionId = req.query.id || 'test_session_123';
    
    // Create modified request with session ID as the id
    const modifiedRequest = {
      ...req.body,
      id: sessionId
    };
    
    console.log(`Forwarding modified request to Xano with id: ${sessionId}`);
    
    // Forward to Xano's JSON-RPC endpoint
    const xanoResponse = await fetch(XANO_JSONRPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modifiedRequest)
    });
    
    // Get response from Xano
    const responseData = await xanoResponse.json();
    
    console.log('Xano response:', JSON.stringify(responseData).substring(0, 200));
    
    // Return Xano's response to the client
    res.status(xanoResponse.status).json(responseData);
  } catch (err) {
    console.error('Error handling JSON-RPC request:', err);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error: ' + err.message
      },
      id: null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Endpoint info endpoint
app.get('/info', (req, res) => {
  res.status(200).json({
    sseEndpoint: '/raw-sse',
    jsonrpcEndpoint: '/jsonrpc',
    xanoSseUrl: XANO_STREAM_URL,
    xanoJsonRpcUrl: XANO_JSONRPC_URL
  });
});

// Support the /raw-sse/jsonrpc path too for compatibility
app.post('/raw-sse/jsonrpc', async (req, res) => {
  try {
    console.log('Received JSON-RPC request via /raw-sse/jsonrpc');
    
    // Get the session ID, using same logic as the SSE endpoint
    const sessionId = req.query.id || 'test_session_123';
    
    // Create modified request with session ID as the id
    const modifiedRequest = {
      ...req.body,
      id: sessionId
    };
    
    console.log(`Forwarding modified request to Xano with id: ${sessionId}`);
    
    // Forward to Xano's JSON-RPC endpoint
    const xanoResponse = await fetch(XANO_JSONRPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modifiedRequest)
    });
    
    // Get response from Xano
    const responseData = await xanoResponse.json();
    
    // Return Xano's response to the client
    res.status(xanoResponse.status).json(responseData);
  } catch (err) {
    console.error('Error handling JSON-RPC request:', err);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error: ' + err.message
      },
      id: null
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
