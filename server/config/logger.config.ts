import { addColors, createLogger, format, Logger, transports } from "winston";
import fs from "fs";
import { sanitizeWinstonInfo } from "../utils/log-sanitizer";

const { combine, printf, timestamp, errors } = format;

const customLevels = {
  levels: {
    error: 0,
    success: 1,
    info: 2,
    debug: 3,
  },

  colors: {
    error: "bold red",
    success: "bold green",
    info: "bold blue",
    debug: "bold yellow",
  },
} as const;

addColors(customLevels.colors);

const getISTTimestamp = (): string => {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
};

const colorizer = format.colorize();

// Custom Winston format to scrub all sensitive data before formatting
const sanitizerFormat = format((info) => sanitizeWinstonInfo(info));

const logFormat = printf((rawInfo) => {
  const sanitized = sanitizeWinstonInfo(rawInfo);
  const { timestamp, level, message, stack } = sanitized;
  const formattedMessage = `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;

  return colorizer.colorize(level, formattedMessage);
});

const consoleFormat = combine(
  timestamp({
    format: getISTTimestamp,
  }),
  errors({
    stack: true,
  }),
  sanitizerFormat(),
  logFormat,
);

const fileFormat = combine(
  timestamp({
    format: getISTTimestamp,
  }),
  errors({
    stack: true,
  }),
  sanitizerFormat(),
  printf((rawInfo) => {
    const sanitized = sanitizeWinstonInfo(rawInfo);
    const { timestamp, level, message, stack } = sanitized;
    return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
  }),
);

export interface ILogger extends Logger {
  success: (message: string) => void;
}

// Ensure logs directory exists if file logging is enabled
const shouldLogToFile = process.env.DISABLE_FILE_LOGS !== "true";
if (shouldLogToFile) {
  try {
    if (!fs.existsSync("logs")) {
      fs.mkdirSync("logs", { recursive: true });
    }
  } catch {
    // Gracefully continue with console transport only if filesystem is read-only
  }
}

const activeTransports: transports.StreamTransportInstance[] = [
  new transports.Console({
    format: consoleFormat,
  }),
];

if (shouldLogToFile) {
  try {
    activeTransports.push(
      new transports.File({
        filename: "logs/error.log",
        level: "error",
        format: fileFormat,
      }),
      new transports.File({
        filename: "logs/combined.log",
        format: fileFormat,
      }),
    );
  } catch {
    // Ignore file transport failures in constrained environments
  }
}

const baseLogger = createLogger({
  levels: customLevels.levels,

  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),

  transports: activeTransports,
});

export const logger: ILogger = Object.assign(baseLogger, {
  success(message: string) {
    return baseLogger.log("success", message);
  },
});
