export class AppError extends Error {
    constructor(code, message, {status = 500, details, cause} = {}) {
        super(message, {cause});
        this.name = this.constructor.name;
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export class InvalidUrlError extends AppError {
    constructor(message = 'The supplied URL is not allowed.', details) {
        super('INVALID_URL', message, {status: 400, details});
    }
}

export class UpstreamError extends AppError {
    constructor(code, message, {status = 502, details, cause} = {}) {
        super(code, message, {status, details, cause});
    }
}

export const publicError = (error) => {
    if (error instanceof AppError) {
        return {
            status: error.status,
            body: {
                error: {
                    code: error.code,
                    message: error.message,
                    ...(error.details ? {details: error.details} : {}),
                },
            },
        };
    }

    return {
        status: 500,
        body: {
            error: {
                code: 'INTERNAL_ERROR',
                message: 'The extraction request could not be completed.',
            },
        },
    };
};
