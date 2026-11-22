export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  correlationId?: string;
  service?: string;
  [key: string]: unknown;
}

export class Logger {
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      correlationId: context?.correlationId,
      ...(context && { context }),
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      })
    };

    // Output pure structured JSON line for easy aggregation (ELK, CloudWatch, Loki)
    const formatted = JSON.stringify(entry);
    if (level === 'ERROR') {
      console.error(formatted);
    } else if (level === 'WARN') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  public debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  public warn(message: string, context?: LogContext, error?: Error): void {
    this.log('WARN', message, context, error);
  }

  public error(message: string, context?: LogContext, error?: Error): void {
    this.log('ERROR', message, context, error);
  }
}

export const createLogger = (serviceName: string): Logger => new Logger(serviceName);
