const express = require('express');
const fetch = require('node-fetch');
const app = express();

const PORT = process.env.PORT || 3000;
const XANO_STREAM_URL = 'https://xnwv-v1z6-dvnr.n7c.xano.io/api:13ckfFnv/stream';

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Main SSE endpoint
app.get('/raw-sse', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Get session ID from query parameters
  const sessionId = req.query.id || 'default_session';
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
