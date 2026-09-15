// Fields safe to expose over the API for a related User (never passwordHash).
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;
