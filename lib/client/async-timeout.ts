export const DEFAULT_CLIENT_TIMEOUT_MS = 12_000;

export class ClientTimeoutError extends Error {
  constructor() {
    super("La solicitud demoró demasiado.");
    this.name = "ClientTimeoutError";
  }
}

export async function withClientTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClientTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchWithClientTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  return fetch(input, { ...init, signal });
}
