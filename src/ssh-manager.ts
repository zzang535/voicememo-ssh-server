import { NodeSSH } from 'node-ssh';
import { SSHConnectionConfig, SSHSession } from './types';

export class SSHManager {
  private sessions: Map<string, SSHSession> = new Map();

  async createSession(sessionId: string, config: SSHConnectionConfig): Promise<SSHSession> {
    try {
      const ssh = new NodeSSH();

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
      });

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
      const shell = await session.connection.requestShell({
        cols,
        rows,
        term: 'xterm-256color',
      });

      session.shell = shell;
      return shell;
    } catch (error) {
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