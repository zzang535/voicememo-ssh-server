import { NodeSSH } from 'node-ssh';
import { SSHConnectionConfig, SSHSession } from './types';

export class SSHManager {
  private sessions: Map<string, SSHSession> = new Map();

  async createSession(sessionId: string, config: SSHConnectionConfig): Promise<SSHSession> {
    try {
      const ssh = new NodeSSH();

      // Add SSH event listeners for debugging
      ssh.connection?.on("error", (e: Error) => {
        console.error(`SSH error for session ${sessionId}:`, e);
      });

      ssh.connection?.on("end", () => {
        console.warn(`SSH end for session ${sessionId}`);
      });

      ssh.connection?.on("close", (hadErr: boolean) => {
        console.warn(`SSH close for session ${sessionId}, hadErr:`, hadErr);
      });

      console.log(`Attempting SSH connection for session ${sessionId}...`);

      // Connect to SSH server
      await ssh.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        readyTimeout: 30000,
        tryKeyboard: true,
        keepaliveInterval: 15000,
        keepaliveCountMax: 4,
      });

      console.log(`SSH connection successful for session ${sessionId}`);

      const session: SSHSession = {
        id: sessionId,
        connection: ssh,
        isConnected: true,
      };

      this.sessions.set(sessionId, session);
      return session;
    } catch (error) {
      throw new Error(`SSH connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createShell(sessionId: string, cols: number = 80, rows: number = 24): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isConnected) {
      throw new Error('Session not found or not connected');
    }

    try {
      console.log(`Requesting shell for session ${sessionId} with dimensions ${cols}x${rows}`);
      const shell = await session.connection.requestShell({
        cols,
        rows,
        term: 'xterm-256color',
      });

      // Add shell stream event listeners
      shell.on("error", (e: Error) => {
        console.error(`SSH stream error for session ${sessionId}:`, e);
      });

      shell.on("close", (code: number | null, signal: string | null) => {
        console.warn(`Shell closed for session ${sessionId}:`, { code, signal });
      });

      session.shell = shell;
      console.log(`Shell successfully created for session ${sessionId}`);

      return shell;
    } catch (error) {
      console.error(`Failed to create shell for session ${sessionId}:`, error);
      throw new Error(`Failed to create shell: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async executeCommand(sessionId: string, command: string): Promise<{ stdout: string; stderr: string }> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isConnected) {
      throw new Error('Session not found or not connected');
    }

    try {
      const result = await session.connection.execCommand(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      throw new Error(`Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async resizeShell(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.shell) {
      throw new Error('Session or shell not found');
    }

    try {
      session.shell.setWindow(rows, cols);
    } catch (error) {
      console.error('Failed to resize shell:', error);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      if (session.shell) {
        session.shell.end();
      }
      if (session.connection) {
        session.connection.dispose();
      }
      session.isConnected = false;
    } catch (error) {
      console.error('Error closing session:', error);
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  getSession(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): SSHSession[] {
    return Array.from(this.sessions.values());
  }
}