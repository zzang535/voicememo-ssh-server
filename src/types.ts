export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SSHMessage {
  type: 'connect' | 'command' | 'resize' | 'disconnect';
  data?: any;
  config?: SSHConnectionConfig;
  command?: string;
  cols?: number;
  rows?: number;
}

export interface SSHResponse {
  type: 'connected' | 'data' | 'error' | 'disconnected';
  data?: any;
  error?: string;
  sessionId?: string;
}

export interface SSHSession {
  id: string;
  connection: any;
  shell?: any;
  isConnected: boolean;
}