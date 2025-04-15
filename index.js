  const express = require('express');
  const fetch = require('node-fetch');
  const bodyParser = require('body-parser');
  const EventSource = require('eventsource');

  const app = express();
  app.use(bodyParser.json());

  const PORT = process.env.PORT || 3000;
  const XANO_JSONRPC_URL = 'https://xnwv-v1z6-dvnr.n7c.xano.io/api:13ckfFnv/jsonrpc';

  // Store active SSE connections
  const activeConnections = new Map();

  // Log helper
  const log = (msg, data) => {
    console.log(`[${new Date().toISOString()}] ${msg}`, data ? data : '');
  };

  // Handle SSE connection
  app.get('/sse', (req, res) => {
    const sessionId = req.query.id || `session_${Date.now()}`;
    log(`New SSE connection: ${sessionId}`);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Function to send SSE messages
    const sendSSE = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      log(`Sent SSE message: ${JSON.stringify(data).substring(0, 100)}...`);
    };

    // Store connection info
    activeConnections.set(sessionId, { res, sendSSE });

    // Set up heartbeat
    const heartbeatInterval = setInterval(() => {
      res.write(':\n\n'); // SSE comment for heartbeat
    }, 5000);

    // Handle client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      activeConnections.delete(sessionId);
      log(`SSE connection closed: ${sessionId}`);
    });
  });

  // Handle JSON-RPC requests
  app.post('/jsonrpc', async (req, res) => {
    const request = req.body;
    log(`Received JSON-RPC request: ${request.method}`, request);

    // Get session ID
    const sessionId = req.query.id || request.id;

    // Handle initialize request specially
    if (request.method === 'initialize') {
      // Prepare initialize response
      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          server_info: {
            name: 'Xano MCP Server',
            version: '1.0.0'
          },
          capabilities: {
            methods: ['initialize', 'tools/list', 'tools/invoke']
          }
        }
      };

      // Send response
      res.json(response);

      // If there's an active SSE connection, send the same response there
      if (activeConnections.has(sessionId)) {
        activeConnections.get(sessionId).sendSSE(response);
      }

      return;
    }

    // For other requests, forward to Xano
    try {
      // Modify request to use string session ID
      const modifiedRequest = {
        ...request,
        id: sessionId
      };

      // Forward to Xano
      const xanoResponse = await fetch(XANO_JSONRPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modifiedRequest)
      });

      // Get response
      const responseData = await xanoResponse.json();

      // Special handling for tools/list to ensure proper format
      if (request.method === 'tools/list' && Array.isArray(responseData.result)) {
        responseData.result = {
          tools: responseData.result
        };
      }

      // Preserve original request ID
      responseData.id = request.id;

      // Send response
      res.json(responseData);
    } catch (error) {
      log(`Error forwarding request to Xano: ${error.message}`);
      res.status(500).json({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal server error: ' + error.message
        }
      });
    }
  });

  // Keep-alive ping endpoint
  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  // Start server
  app.listen(PORT, () => {
    log(`Server running on port ${PORT}`);
  });

  This simplified approach:
  1. Creates a dedicated SSE endpoint at /sse
  2. Handles JSON-RPC requests at /jsonrpc
  3. Tracks active SSE connections
  4. Responds to initialize requests immediately
  5. Follows the approach outlined in the Cloudflare documentation

  Try updating your mcp-remote configuration to use these new endpoints:
  {
    "mcpServers": {
      "xano-remote": {
        "command": "npx",
        "args": [
          "mcp-remote",
          "https://claude-sse-proxy.onrender.com/sse?id=test_session_123"
        ]
      }
    }
  }
