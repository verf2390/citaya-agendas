export type WhatsAppWebhookDirection = "inbound" | "status";

export type WhatsAppDeliveryStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type WhatsAppWebhookEvent = {
  eventKey: string;
  phoneNumberId: string;
  providerMessageId: string;
  direction: WhatsAppWebhookDirection;
  eventType: "message" | WhatsAppDeliveryStatus;
  occurredAt: string;
};

export type WhatsAppTemplateSendInput = {
  to: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
};

export type WhatsAppSendResult = {
  providerMessageId: string;
};

export interface WhatsAppProvider {
  readonly id: "meta_cloud";
  sendTemplate(input: WhatsAppTemplateSendInput): Promise<WhatsAppSendResult>;
}
