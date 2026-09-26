export class ValidationError extends Error {
    /** `data` (optional) is sent back as the response's `data`, for machine-readable details. */
    constructor(message, data) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
        if (data !== undefined) this.data = data;
    }
}

export class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = 401;
    }
}

export class ForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
        this.statusCode = 403;
    }
}


export class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
        this.statusCode = 404;
    }
}

