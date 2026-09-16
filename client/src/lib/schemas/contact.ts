import { z } from "zod";

// Mirrors the server's contactSchema in server/src/routes/contacts.ts —
// keep the two in sync if either changes.
export const contactFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.union([z.string().trim().email("Enter a valid email address"), z.literal("")]),
  phone: z.string().trim(),
  title: z.string().trim(),
  companyId: z.string(),
  ownerId: z.string(),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export const emptyContactForm: ContactFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  title: "",
  companyId: "",
  ownerId: "",
};

export type ContactFormErrors = Partial<Record<keyof ContactFormValues, string>>;

export interface ContactApiPayload {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  ownerId: string | null;
}

export function toContactApiPayload(values: ContactFormValues): ContactApiPayload {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email || null,
    phone: values.phone || null,
    title: values.title || null,
    companyId: values.companyId || null,
    ownerId: values.ownerId || null,
  };
}

export function validateContactForm(values: ContactFormValues): ContactFormErrors {
  const result = contactFormSchema.safeParse(values);
  if (result.success) return {};

  const errors: ContactFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof ContactFormValues | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}
