export type SiiEnvironment = "certification" | "production";

export type SendDteToSiiInput = {
  tenantId: string;
  signedXml: string;
  environment: SiiEnvironment;
};

export type SendDteToSiiResult = {
  ok: true;
  environment: SiiEnvironment;
  trackId: string;
  status: "sent_to_sii";
  mock: true;
};

export type DteStatusResult = {
  ok: true;
  environment: SiiEnvironment;
  trackId: string;
  status: "accepted" | "rejected" | "sent_to_sii";
  mock: true;
};

export async function getSeed(environment: SiiEnvironment): Promise<string> {
  return `MOCK-SEED-${environment.toUpperCase()}`;
}

export async function getToken(seed: string): Promise<string> {
  return `MOCK-TOKEN-FOR-${seed}`;
}

export async function sendDteToSii(
  input: SendDteToSiiInput,
): Promise<SendDteToSiiResult> {
  return {
    ok: true,
    environment: input.environment,
    trackId: `MOCK-${input.tenantId}-${Date.now()}`,
    status: "sent_to_sii",
    mock: true,
  };
}

export async function getDteStatus(
  environment: SiiEnvironment,
  trackId: string,
): Promise<DteStatusResult> {
  return {
    ok: true,
    environment,
    trackId,
    status: "accepted",
    mock: true,
  };
}

