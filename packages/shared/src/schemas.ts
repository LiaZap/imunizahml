import { z } from 'zod';

export const PhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Telefone no formato E.164 (ex: +5511999999999)');

export const PatientProfileSchema = z
  .object({
    babyAgeMonths: z.number().int().min(0).max(240).optional(),
    babyName: z.string().optional(),
    medicalConditions: z.array(z.string()).optional(),
    vaccineHistory: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .partial();

export type PatientProfile = z.infer<typeof PatientProfileSchema>;

export const VaccinePackageItemSchema = z.object({
  vaccineSlug: z.string(),
  doses: z.number().int().positive(),
});

export type VaccinePackageItem = z.infer<typeof VaccinePackageItemSchema>;

// Formato real do webhook da Uazapi (uazapiGO-Webhook/1.0)
// Enviamos o token da instância no campo body.token, então validamos por ali.
export const UazapiWebhookMessageSchema = z
  .object({
    EventType: z.string().optional(),
    event: z.string().optional(), // fallback p/ eventuais variantes
    instanceName: z.string().optional(),
    instance: z.string().optional(),
    owner: z.string().optional(),
    token: z.string().optional(),
    BaseUrl: z.string().optional(),
    chat: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        wa_chatid: z.string().optional(),
        wa_isGroup: z.boolean().optional(),
        wa_name: z.string().optional(),
        wa_contactName: z.string().optional(),
        lead_fullName: z.string().optional(),
        lead_name: z.string().optional(),
        image: z.string().optional(),
        imagePreview: z.string().optional(),
      })
      .passthrough()
      .optional(),
    message: z
      .object({
        id: z.string().optional(),
        messageid: z.string().optional(),
        chatid: z.string().optional(),
        chatlid: z.string().optional(),
        sender: z.string().optional(),
        sender_pn: z.string().optional(),
        sender_lid: z.string().optional(),
        senderName: z.string().optional(),
        groupName: z.string().optional(),
        owner: z.string().optional(),
        fromMe: z.boolean().optional(),
        isGroup: z.boolean().optional(),
        type: z.string().optional(), // text | image | audio | video | document | ...
        messageType: z.string().optional(), // Conversation | ExtendedTextMessage | AudioMessage | ImageMessage | ...
        mediaType: z.string().optional(),
        // content pode ser string (texto) ou objeto (mídia com url/mimeType)
        content: z.union([z.string(), z.record(z.any())]).optional(),
        text: z.string().optional(),
        caption: z.string().optional(),
        fileName: z.string().optional(),
        mimeType: z.string().optional(),
        mimetype: z.string().optional(),
        fileURL: z.string().optional(),
        mediaURL: z.string().optional(),
        url: z.string().optional(),
        seconds: z.number().optional(),
        messageTimestamp: z.union([z.number(), z.string()]).optional(),
        status: z.string().optional(),
        source: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type UazapiWebhookMessage = z.infer<typeof UazapiWebhookMessageSchema>;
