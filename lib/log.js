const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info',
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console()
    ]
});

module.exports = {
    debug: function(message) { logger.log('debug', JSON.stringify(message))},
    info: function(message) { logger.log('info', JSON.stringify(message))},
    warn: function(message) { logger.log('warn', JSON.stringify(message))},
    crit: function(message) { logger.log('crit', JSON.stringify(message))}
}