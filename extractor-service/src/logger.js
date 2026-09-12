const LEVELS = new Map([
    ['debug', 10],
    ['info', 20],
    ['warn', 30],
    ['error', 40],
    ['silent', 100],
]);

export const createLogger = (levelName = 'info') => {
    const threshold = LEVELS.get(levelName) ?? LEVELS.get('info');
    const write = (level, message, fields = {}) => {
        if ((LEVELS.get(level) ?? 100) < threshold) {
            return;
        }

        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...fields,
        };
        const output = JSON.stringify(entry);
        if (level === 'error') {
            console.error(output);
        } else {
            console.log(output);
        }
    };

    return {
        debug: (message, fields) => write('debug', message, fields),
        info: (message, fields) => write('info', message, fields),
        warn: (message, fields) => write('warn', message, fields),
        error: (message, fields) => write('error', message, fields),
    };
};
