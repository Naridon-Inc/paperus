const { isProduction } = require('./config');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = isProduction ? LOG_LEVELS.info : LOG_LEVELS.debug;

function formatMessage(level, context, message, data) {
    const timestamp = new Date().toISOString();
    const base = { timestamp, level, context, message };
    if (data !== undefined) base.data = data;
    return JSON.stringify(base);
}

const logger = {
    debug(context, message, data) {
        if (currentLevel <= LOG_LEVELS.debug) {
            console.log(formatMessage('debug', context, message, data));
        }
    },
    info(context, message, data) {
        if (currentLevel <= LOG_LEVELS.info) {
            console.log(formatMessage('info', context, message, data));
        }
    },
    warn(context, message, data) {
        if (currentLevel <= LOG_LEVELS.warn) {
            console.warn(formatMessage('warn', context, message, data));
        }
    },
    error(context, message, data) {
        if (currentLevel <= LOG_LEVELS.error) {
            console.error(formatMessage('error', context, message, data));
        }
    },
};

module.exports = logger;
