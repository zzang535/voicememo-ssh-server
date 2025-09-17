import WebSocket from 'ws';
import { createServer } from 'http';
import { SSHManager } from './ssh-manager';
import { SSHMessage, SSHResponse } from './types';

const PORT = process.env.PORT || 8001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// Create HTTP server
const server = createServer();

// Add HTTP server error handling
server.on("clientError", (err, socket) => {
  console.error("HTTP clientError:", err);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.on("close", () => {
  console.warn("HTTP server closed");
});

server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  verifyClient: (info: { origin?: string }) => {
    // Allow all origins
    return true;
  }
});

const sshManager = new SSHManager();

// WebSocket ping/pong keepalive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000); // 30초마다 ping

// Generate unique session ID
function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

wss.on('connection', (ws: WebSocket, req) => {
  console.log('WS connected', {
    ip: req.socket.remoteAddress,
    ua: req.headers['user-agent'],
    origin: req.headers.origin
  });

  let sessionId: string | null = null;

  // Add WebSocket event listeners for debugging
  ws.on("error", (err) => {
    console.error("WS error:", err);
    if (sessionId) {
      console.error(`WS error for session ${sessionId}:`, err);
    }
  });

  ws.on("close", (code, reason) => {
    console.warn("WS close:", {
      code,
      reason: reason?.toString(),
      sessionId,
      timestamp: new Date().toISOString()
    });
  });

  // Send response to client
  const sendResponse = (response: SSHResponse) => {
    console.log(`Attempting to send response: ${response.type} (WebSocket state: ${ws.readyState})`);
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(response));
        console.log(`Successfully sent response: ${response.type}`);
      } catch (error) {
        console.error(`Failed to send response: ${response.type}`, error);
      }
    } else {
      console.warn(`Cannot send response ${response.type}: WebSocket not open (state: ${ws.readyState})`);
    }
  };

  // Handle incoming messages
  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const message: SSHMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'connect':
          if (!message.config) {
            sendResponse({ type: 'error', error: 'SSH configuration required' });
            return;
          }

          try {
            sessionId = generateSessionId();
            console.log(`Creating SSH session: ${sessionId} to ${message.config.username}@${message.config.host}:${message.config.port}`);

            const session = await sshManager.createSession(sessionId, message.config);
            console.log(`SSH connection established for session: ${sessionId}`);

            const shell = await sshManager.createShell(sessionId, 80, 24);
            console.log(`Shell created for session: ${sessionId}`);

            // Handle shell data output
            shell.on('data', (data: Buffer) => {
              const dataStr = data.toString();
              console.log(`Shell data for session ${sessionId}: ${dataStr.substring(0, 100)}...`);

              // Check WebSocket state before sending
              if (ws.readyState === WebSocket.OPEN) {
                sendResponse({
                  type: 'data',
                  data: dataStr,
                });
              } else {
                console.warn(`WebSocket not open (state: ${ws.readyState}) when trying to send data for session ${sessionId}`);
              }
            });

            // Handle shell close - don't close WebSocket immediately
            shell.on('close', (code: number | null, signal: string | null) => {
              console.log(`Shell closed for session: ${sessionId} (code: ${code}, signal: ${signal})`);
              // Only close if it's an unexpected closure or error
              if (code !== 0 && code !== null) {
                sendResponse({ type: 'disconnected' });
                if (sessionId) {
                  sshManager.closeSession(sessionId);
                }
              }
            });

            // Handle shell error
            shell.on('error', (error: Error) => {
              console.error(`Shell error for session ${sessionId}:`, error);
              sendResponse({
                type: 'error',
                error: error.message,
              });
              // Close session on shell error
              if (sessionId) {
                sshManager.closeSession(sessionId);
              }
            });

            sendResponse({ type: 'connected', sessionId });
            console.log(`SSH session ${sessionId} connected successfully`);

          } catch (error) {
            console.error('SSH connection error:', error);
            sendResponse({
              type: 'error',
              error: error instanceof Error ? error.message : 'Connection failed',
            });
          }
          break;

        case 'command':
          if (!sessionId) {
            sendResponse({ type: 'error', error: 'No active session' });
            return;
          }

          if (!message.command) {
            sendResponse({ type: 'error', error: 'Command required' });
            return;
          }

          try {
            const session = sshManager.getSession(sessionId);
            if (!session || !session.shell) {
              sendResponse({ type: 'error', error: 'Shell not available' });
              return;
            }

            // Write command to shell
            session.shell.write(message.command);
          } catch (error) {
            console.error('Command execution error:', error);
            sendResponse({
              type: 'error',
              error: error instanceof Error ? error.message : 'Command failed',
            });
          }
          break;

        case 'resize':
          if (!sessionId) {
            sendResponse({ type: 'error', error: 'No active session' });
            return;
          }

          try {
            await sshManager.resizeShell(
              sessionId,
              message.cols || 80,
              message.rows || 24
            );
          } catch (error) {
            console.error('Resize error:', error);
          }
          break;

        case 'disconnect':
          if (sessionId) {
            console.log(`Disconnecting session: ${sessionId}`);
            await sshManager.closeSession(sessionId);
            sessionId = null;
          }
          sendResponse({ type: 'disconnected' });
          break;

        default:
          sendResponse({ type: 'error', error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Message parsing error:', error);
      sendResponse({
        type: 'error',
        error: 'Invalid message format',
      });
    }
  });

  // Handle connection close
  ws.on('close', async () => {
    console.log('WebSocket connection closed');
    if (sessionId) {
      console.log(`Cleaning up session: ${sessionId}`);
      await sshManager.closeSession(sessionId);
    }
  });

  // Handle connection error
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (sessionId) {
      sshManager.closeSession(sessionId);
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`SSH WebSocket server listening on port ${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down SSH server...');
  wss.close(() => {
    server.close(() => {
      console.log('SSH server stopped');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down SSH server...');
  wss.close(() => {
    server.close(() => {
      console.log('SSH server stopped');
      process.exit(0);
    });
  });
});