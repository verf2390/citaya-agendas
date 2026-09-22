import type {
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateSendInput,
} from "@/lib/whatsapp/types";

function assertToken(value: string) {
  const token = value.trim();
  if (token.length < 20) throw new Error("WhatsApp access token inválido");
  return token;
}

function assertPhoneNumberId(value: string) {
  const id = value.trim();
  if (!/^\d{5,64}$/.test(id)) throw new Error("WhatsApp phone_number_id inválido");
  return id;
}

function assertGraphVersion(value: string) {
  const version = value.trim();
  if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) {
    throw new Error("Versión Graph inválida");
  }
  return version;
}

function normalizeRecipient(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error("Destinatario WhatsApp inválido");
  }
  return digits;
}

function templateName(value: string) {
  const name = value.trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    throw new Error("Template WhatsApp inválido");
  }
  return name;
}

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly id = "meta_cloud" as const;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly graphVersion: string;

  constructor(input: {
    accessToken: string;
    phoneNumberId: string;
    graphVersion: string;
  }) {
    this.accessToken = assertToken(input.accessToken);
    this.phoneNumberId = assertPhoneNumberId(input.phoneNumberId);
    this.graphVersion = assertGraphVersion(input.graphVersion);
  }

  async sendTemplate(
    input: WhatsAppTemplateSendInput,
  ): Promise<WhatsAppSendResult> {
    const to = normalizeRecipient(input.to);
    const name = templateName(input.templateName);
    const languageCode = input.languageCode.trim();
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)) {
      throw new Error("Idioma de template WhatsApp inválido");
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name,
            language: { code: languageCode },
            ...(input.components?.length
              ? { components: input.components }
              : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error("WhatsApp provider unavailable");
    }

    const payload = (await response.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }> }
      | null;
    const providerMessageId = payload?.messages?.[0]?.id?.trim() ?? "";
    if (!providerMessageId) {
      throw new Error("WhatsApp provider response inválida");
    }

    return { providerMessageId };
  }
}
