  const express = require('express');
  const fetch = require('node-fetch');
  const app = express();

  const PORT = process.env.PORT || 3000;
  const XANO_STREAM_URL = 'https://xnwv-v1z6-dvnr.n7c.xano.io/api:13ckfFnv/stream';
  const XANO_JSONRPC_URL = 'https://xnwv-v1z6-dvnr.n7c.xano.io/api:13ckfFnv/jsonrpc';

  // Detailed request logging
  const logRequest = (req, data) => {
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log(`Headers: ${JSON.stringify(req.headers)}`);
    if (data) {
      console.log(`Body: ${JSON.stringify(data).substring(0, 500)}`);
    }
    if (req.query && Object.keys(req.query).length > 0) {
      console.log(`Query params: ${JSON.stringify(req.query)}`);
    }
  };

  // Parse JSON bodies
  app.use(express.json());

  // CORS middleware for all responses
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Pre-flight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  });

  // Keep-alive ping endpoint - to prevent Render from spinning down
  app.get('/ping', (req, res) => {
    res.status(200).send('pong');
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Info endpoint for debugging
  app.get('/info', (req, res) => {
    res.status(200).json({
      sseEndpoint: '/raw-sse',
      jsonrpcEndpoint: '/jsonrpc',
      xanoSseUrl: XANO_STREAM_URL,
      xanoJsonRpcUrl: XANO_JSONRPC_URL,
      startTime: process.uptime()
    });
  });

  // Enhanced SSE endpoint with persistent connection
  app.get('/raw-sse', async (req, res) => {
    // Log the incoming request
    logRequest(req);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Get session ID from query parameters or generate a default
    const sessionId = req.query.id || `session_${Date.now()}`;
    console.log(`[SSE] Using session ID: ${sessionId}`);

    const xanoUrl = `${XANO_STREAM_URL}?id=${sessionId}`;
    console.log(`[SSE] Connecting to Xano SSE at: ${xanoUrl}`);

    try {
      // Connect to Xano's SSE endpoint
      const xanoResponse = await fetch(xanoUrl);

      if (!xanoResponse.ok) {
        console.error(`[SSE] Xano error: ${xanoResponse.status} ${xanoResponse.statusText}`);
        res.status(502).end(`Error connecting to Xano: ${xanoResponse.status}`);
        return;
      }

      console.log(`[SSE] Connected to Xano SSE stream for session: ${sessionId}`);

      // Set up a keep-alive heartbeat to maintain the connection
      const heartbeatInterval = setInterval(() => {
        res.write(':\n\n'); // SSE comment for heartbeat
        console.log(`[SSE] Sent heartbeat for session: ${sessionId}`);
      }, 5000); // Send a heartbeat every 5 seconds

      // Handle the case where Xano might return a single JSON response instead of an SSE stream
      const contentType = xanoResponse.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        // If Xano returns JSON directly, convert it to SSE format
        const jsonData = await xanoResponse.json();

        // Extract single object if it's an array
        const responseObj = Array.isArray(jsonData) ? jsonData[0] : jsonData;

        // Format as SSE
        const sseMessage = `data: ${JSON.stringify(responseObj)}\n\n`;
        res.write(sseMessage);
        console.log(`[SSE] Converted JSON to SSE: ${sseMessage.trim()}`);

        // Connection will be kept alive by the heartbeat
      } else {
        // Process as normal SSE stream
        // Process incoming data chunks
        xanoResponse.body.on('data', (chunk) => {
          // Convert buffer to string
          const text = chunk.toString();

          // SPECIFIC FIX: Check if it contains the ID line that's causing issues
          if (text.includes('id: ')) {
            // Skip the ID line and only process the JSON-RPC message
            const lines = text.split('\n');
            for (const line of lines) {
              // Only process the actual JSON-RPC message
              if (line.includes('jsonrpc') && line.includes('result')) {
                // Check if the line already has a "data: " prefix and remove it
                const cleanLine = line.startsWith('data: ') ? line.substring(6) : line;
                const sseMessage = `data: ${cleanLine}\n\n`;
                res.write(sseMessage);
                console.log(`[SSE] Forwarded clean JSON: ${sseMessage.trim()}`);
              }
            }
          } else {
            // Normal processing for other chunks
            try {
              // Check if it's already in SSE format
              if (text.startsWith('data: ')) {
                // Already in SSE format, forward as is but ensure double newline
                if (!text.endsWith('\n\n')) {
                  res.write(text + '\n\n');
                } else {
                  res.write(text);
                }
                console.log(`[SSE] Forwarded SSE: ${text.trim()}`);
              } else {
                // Try to parse as JSON
                try {
                  let jsonData;
                  if (text.trim().startsWith('[') && text.trim().endsWith(']')) {
                    // Handling array response
                    jsonData = JSON.parse(text.trim());
                    jsonData = jsonData[0]; // Extract first object
                  } else {
                    // Regular JSON
                    jsonData = JSON.parse(text.trim());
                  }

                  // Format as SSE with proper prefix and newlines
                  const sseMessage = `data: ${JSON.stringify(jsonData)}\n\n`;
                  res.write(sseMessage);
                  console.log(`[SSE] Converted to SSE: ${sseMessage.trim()}`);
                } catch (parseError) {
                  // Not valid JSON, just forward the text as is but add SSE format
                  const sseMessage = `data: ${text}\n\n`;
                  res.write(sseMessage);
                  console.log(`[SSE] Forwarded as plain text SSE: ${sseMessage.trim()}`);
                }
              }
            } catch (e) {
              console.error(`[SSE] Error processing chunk: ${e.message}`);
            }
          }
        });

        // When Xano stream ends, KEEP THE CONNECTION ALIVE
        xanoResponse.body.on('end', () => {
          console.log(`[SSE] Xano stream ended for session: ${sessionId}, but keeping client connection open`);

          // Send a re-initialization response to maintain the session
          const initResponse = {
            jsonrpc: "2.0",
            id: sessionId,
            result: {
              server_info: {
                name: "xano-mcp-super-server",
                version: "1.0.0"
              },
              capabilities: {
                methods: ["initialize", "tools/list", "tools/invoke"],
                tools: {}
              }
            }
          };

          // Format as SSE and send
          const sseMessage = `data: ${JSON.stringify(initResponse)}\n\n`;
          res.write(sseMessage);
          console.log(`[SSE] Sent re-initialization message to keep connection alive`);

          // Do not end the connection - it will be kept alive by the heartbeat
        });

        // Handle stream errors
        xanoResponse.body.on('error', (err) => {
          console.error(`[SSE] Stream error for session ${sessionId}:`, err);
          // Do not end the connection - it will be kept alive by the heartbeat
        });
      }

      // Handle client disconnect
      req.on('close', () => {
        clearInterval(heartbeatInterval);
        console.log(`[SSE] Client disconnected for session: ${sessionId}`);
      });
    } catch (err) {
      console.error(`[SSE] Connection error for session ${sessionId}:`, err);
      res.status(500).end('Server error');
    }
  });

  // Enhanced JSON-RPC endpoint - preserves Claude's session ID
  app.post('/jsonrpc', async (req, res) => {
    // Log the incoming request
    logRequest(req, req.body);

    try {
      // Get the client's request body
      const clientRequest = req.body;

      // Get session ID from query parameters, or use the client's ID if it's a string
      let sessionId;
      if (req.query.id) {
        sessionId = req.query.id;
        console.log(`[RPC] Using session ID from URL: ${sessionId}`);
      } else if (typeof clientRequest.id === 'string' && clientRequest.id.length > 0) {
        sessionId = clientRequest.id;
        console.log(`[RPC] Using session ID from request body: ${sessionId}`);
      } else {
        // For numeric IDs, use a default session ID
        sessionId = `test_session_123`;
        console.log(`[RPC] Using default session ID: ${sessionId}`);
      }

      // Create modified request with session ID as the id
      const modifiedRequest = {
        ...clientRequest,
        id: sessionId
      };

      console.log(`[RPC] Forwarding to Xano with ID: ${sessionId}`);

      // Forward to Xano's JSON-RPC endpoint
      const xanoResponse = await fetch(XANO_JSONRPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modifiedRequest)
      });

      // Parse the Xano response
      let responseData;
      try {
        responseData = await xanoResponse.json();
        console.log(`[RPC] Xano response status: ${xanoResponse.status}`);
        console.log(`[RPC] Xano response data: ${JSON.stringify(responseData).substring(0, 500)}`);
      } catch (e) {
        console.error(`[RPC] Error parsing Xano response: ${e.message}`);
        const rawText = await xanoResponse.text();
        console.log(`[RPC] Raw response: ${rawText.substring(0, 500)}`);

        // Return error to client
        return res.status(502).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Invalid JSON response from server'
          },
          id: clientRequest.id
        });
      }

      // Special handling for tools/list to ensure proper format
      if (clientRequest.method === 'tools/list' && Array.isArray(responseData.result)) {
        console.log(`[RPC] Reformatting tools/list response`);
        responseData.result = {
          tools: responseData.result
        };
      }

      // Return the modified response to the client
      // If client sent numeric ID, preserve it in the response
      if (typeof clientRequest.id === 'number') {
        responseData.id = clientRequest.id;
      }

      // Return the response
      res.status(xanoResponse.status).json(responseData);
    } catch (err) {
      console.error(`[RPC] Error: ${err.message}`);

      // Return a proper error response
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error: ' + err.message
        },
        id: req.body.id
      });
    }
  });

  // Support the /raw-sse/jsonrpc path too for compatibility
  app.post('/raw-sse/jsonrpc', async (req, res) => {
    console.log(`[RPC-ALT] Request to /raw-sse/jsonrpc - forwarding to /jsonrpc handler`);

    // Forward to the main JSON-RPC handler
    req.url = '/jsonrpc';
    app.handle(req, res);
  });

  // Prevent errors for other routes
  app.use((req, res) => {
    console.log(`[404] Not found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Not found' });
  });

  // Handle errors
  app.use((err, req, res, next) => {
    console.error(`[ERROR] ${err.stack}`);
    res.status(500).json({ error: 'Server error' });
  });

  // Start the server
  app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`Xano SSE URL: ${XANO_STREAM_URL}`);
    console.log(`Xano JSON-RPC URL: ${XANO_JSONRPC_URL}`);
  });
