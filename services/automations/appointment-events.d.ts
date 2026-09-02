import type { TenantOperationalCapabilities } from "../../lib/tenant/operational-types";

export type AppointmentOperationalEventResult = {
  called: boolean;
  ok: boolean;
  status: number;
  reason: string | null;
};

export type AppointmentOperationalEventOptions = {
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function shouldDispatchAppointmentCreatedEvent(
  capabilities: TenantOperationalCapabilities,
  duplicate: unknown,
): boolean;

export function buildAppointmentManageUrl(
  publicBaseUrl: string,
  manageToken: string,
): string | null;

export function runPostPersistedAppointmentEffect(
  effect: () => Promise<AppointmentOperationalEventResult>,
): Promise<AppointmentOperationalEventResult>;

export function dispatchAppointmentCreatedEvent(
  input: { appointmentId: string; manageToken: string; publicBaseUrl: string },
  options?: AppointmentOperationalEventOptions,
): Promise<AppointmentOperationalEventResult>;

export function dispatchAppointmentCanceledEvent(
  input: { appointmentId: string; tenantId: string; source: string },
  options?: AppointmentOperationalEventOptions,
): Promise<AppointmentOperationalEventResult>;

export function dispatchAppointmentRescheduledEvent(
  input: {
    appointmentId: string;
    tenantId: string;
    oldStartAt: string;
    oldEndAt: string;
    newStartAt: string;
    newEndAt: string;
    manageToken: string;
    source: string;
  },
  options?: AppointmentOperationalEventOptions,
): Promise<AppointmentOperationalEventResult>;
