export class EngineNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineNotFoundError';
  }
}
