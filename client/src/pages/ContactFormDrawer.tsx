import { useNavigate } from "react-router-dom";
import { Drawer } from "../components/Drawer";
import { ContactForm } from "../components/ContactForm";
import { api } from "../lib/api";
import { emptyContactForm, toContactApiPayload, type ContactFormValues } from "../lib/schemas/contact";
import { useContactsOutletContext } from "./contactsOutletContext";

export function ContactFormDrawer() {
  const navigate = useNavigate();
  const { refetch } = useContactsOutletContext();

  function close() {
    navigate("/contacts");
  }

  async function handleCreate(values: ContactFormValues) {
    const { contact } = await api.post<{ contact: { id: string } }>(
      "/contacts",
      toContactApiPayload(values),
    );
    refetch();
    navigate(`/contacts/${contact.id}`);
  }

  return (
    <Drawer title="New Contact" onClose={close}>
      <ContactForm
        initialValues={emptyContactForm}
        submitLabel="Create contact"
        onSubmit={handleCreate}
        onCancel={close}
      />
    </Drawer>
  );
}
