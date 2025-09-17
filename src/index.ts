import WebSocket from 'ws';
import { createServer } from 'http';
import { SSHManager } from './ssh-manager';
import { SSHMessage, SSHResponse } from './types';

const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// Create HTTP server
const server = createServer();

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  verifyClient: (info: { origin?: string }) => {
    // Allow all origins
    return true;
  }
});

const sshManager = new SSHManager();

// Generate unique session ID
function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket connection established');

  let sessionId: string | null = null;

  // Send response to client
  const sendResponse = (response: SSHResponse) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
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
            console.log(`Creating SSH session: ${sessionId}`);

            const session = await sshManager.createSession(sessionId, message.config);
            const shell = await sshManager.createShell(sessionId, 80, 24);

            // Handle shell data output
            shell.on('data', (data: Buffer) => {
              sendResponse({
                type: 'data',
                data: data.toString(),
              });
            });

            // Handle shell close
            shell.on('close', () => {
              console.log(`Shell closed for session: ${sessionId}`);
              sendResponse({ type: 'disconnected' });
              if (sessionId) {
                sshManager.closeSession(sessionId);
              }
            });

            // Handle shell error
            shell.on('error', (error: Error) => {
              console.error(`Shell error for session ${sessionId}:`, error);
              sendResponse({
                type: 'error',
                error: error.message,
              });
            });

            sendResponse({ type: 'connected' });
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