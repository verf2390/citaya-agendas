export type DemoSettlementAppointment = {
  id: string;
  professional_id: string;
  professional_name: string;
  service_name: string;
  start_at: string;
};

export type DemoSettlement = {
  id: string;
  appointment_id: string;
  professional_name: string;
  service_name: string;
  start_at: string;
  simulated_amount: number;
  percentage_bps: number;
  professional_amount: number;
  business_amount: number;
};

export type DemoProfessional = {
  professional_id: string;
  email: string;
  rut: string;
  role: "professional" | "assistant";
  professionals: { name: string };
};

export type DemoSettlementData = {
  appointments: DemoSettlementAppointment[];
  professionals: DemoProfessional[];
  settlements: DemoSettlement[];
};

export const MAX_DEMO_SETTLEMENT_AMOUNT = 999_999_999;
