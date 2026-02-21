export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id '${id}' not found` : `${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'VALIDATION_ERROR');
  }
}

export class OptimisticLockError extends AppError {
  constructor() {
    super('Record was modified by another user. Please refresh and try again.', 409, 'OPTIMISTIC_LOCK');
  }
}

export function handleError(reply: { status: (n: number) => { send: (v: unknown) => void } }, err: unknown): void {
  if (err instanceof AppError) {
    reply.status(err.statusCode).send({
      error: err.code ?? 'APP_ERROR',
      message: err.message,
    });
  } else {
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
}
