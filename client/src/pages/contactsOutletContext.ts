import type { Dispatch, SetStateAction } from "react";
import { useOutletContext } from "react-router-dom";

export interface ContactSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  lastActivityAt: string | null;
}

export interface ContactsOutletContext {
  contacts: ContactSummary[];
  setContacts: Dispatch<SetStateAction<ContactSummary[]>>;
  refetch: () => void;
}

export function useContactsOutletContext() {
  return useOutletContext<ContactsOutletContext>();
}
