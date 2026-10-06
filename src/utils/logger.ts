/**
 * acp-vscode — Logger Utility
 *
 * Provides two VS Code OutputChannel sinks:
 *   1. Main log channel  — structured INFO/WARN/ERROR messages.
 *   2. Traffic log channel — raw ACP JSON-RPC wire frames for debugging.
 *
 * Usage:
 *   import { Logger } from './utils/logger';
 *   const log = Logger.getInstance();
 *   log.info('Connected', { agent: 'Claude Code' });
 *
 * @module utils/logger
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Log level definitions
// ---------------------------------------------------------------------------

/** Numeric severity levels aligned with common logging conventions. */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// ---------------------------------------------------------------------------
// Logger — singleton
// ---------------------------------------------------------------------------

/**
 * Singleton logger that writes to VS Code Output Channels.
 * Both channels are created lazily on first access and disposed when the
 * extension deactivates via `dispose()`.
 */
export class Logger {
  private static instance: Logger | undefined;

  private readonly mainChannel: vscode.OutputChannel;
  private readonly trafficChannel: vscode.OutputChannel;
  private level: LogLevel = LogLevel.INFO;
  private trafficEnabled = true;

  private constructor() {
    this.mainChannel = vscode.window.createOutputChannel('ACP Client');
    this.trafficChannel = vscode.window.createOutputChannel('ACP Traffic');
  }

  /** Returns the singleton Logger, creating it if necessary. */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Disposes both output channels. Call during extension deactivation. */
  public dispose(): void {
    this.mainChannel.dispose();
    this.trafficChannel.dispose();
    Logger.instance = undefined;
  }

  /** Reveals the main log channel in the VS Code UI. */
  public show(): void {
    this.mainChannel.show(true);
  }

  /** Reveals the traffic log channel in the VS Code UI. */
  public showTraffic(): void {
    this.trafficChannel.show(true);
  }

  /** Updates the minimum log level filter. */
  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Enables or disables JSON-RPC traffic logging. */
  public setTrafficEnabled(enabled: boolean): void {
    this.trafficEnabled = enabled;
  }

  // -------------------------------------------------------------------------
  // Structured log helpers
  // -------------------------------------------------------------------------

  /** Logs a DEBUG-level message. Omitted when level > DEBUG. */
  public debug(message: string, meta?: Record<string, unknown>): void {
    this.write(LogLevel.DEBUG, message, meta);
  }

  /** Logs an INFO-level message. */
  public info(message: string, meta?: Record<string, unknown>): void {
    this.write(LogLevel.INFO, message, meta);
  }

  /** Logs a WARN-level message. */
  public warn(message: string, meta?: Record<string, unknown>): void {
    this.write(LogLevel.WARN, message, meta);
  }

  /** Logs an ERROR-level message. Optionally attaches an Error object. */
  public error(message: string, err?: Error | unknown, meta?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = { ...meta };
    if (err instanceof Error) {
      combined['error'] = err.message;
      combined['stack'] = err.stack;
    } else if (err !== undefined) {
      combined['error'] = String(err);
    }
    this.write(LogLevel.ERROR, message, combined);
  }

  // -------------------------------------------------------------------------
  // Traffic log helpers (ACP JSON-RPC wire frames)
  // -------------------------------------------------------------------------

  /**
   * Appends a raw outgoing JSON-RPC frame to the traffic channel.
   * @param frame - The serialised JSON string sent to the agent.
   */
  public logOutgoing(frame: string): void {
    if (!this.trafficEnabled) { return; }
    this.trafficChannel.appendLine(`>> ${this.timestamp()} ${frame}`);
  }

  /**
   * Appends a raw incoming JSON-RPC frame to the traffic channel.
   * @param frame - The serialised JSON string received from the agent.
   */
  public logIncoming(frame: string): void {
    if (!this.trafficEnabled) { return; }
    this.trafficChannel.appendLine(`<< ${this.timestamp()} ${frame}`);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (level < this.level) { return; }

    const levelTag = LogLevel[level].padEnd(5);
    const ts = this.timestamp();
    let line = `[${levelTag}] ${ts} ${message}`;

    if (meta && Object.keys(meta).length > 0) {
      try {
        line += ` | ${JSON.stringify(meta)}`;
      } catch {
        line += ` | [unserializable meta]`;
      }
    }

    this.mainChannel.appendLine(line);
  }

  private timestamp(): string {
    return new Date().toISOString();
  }
}
