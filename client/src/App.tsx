import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ContactsListPage } from "./pages/ContactsListPage";
import { ContactDetailDrawer } from "./pages/ContactDetailDrawer";
import { ContactFormDrawer } from "./pages/ContactFormDrawer";
import { CompaniesListPage } from "./pages/CompaniesListPage";
import { CompanyDetailPage } from "./pages/CompanyDetailPage";
import { CompanyFormPage } from "./pages/CompanyFormPage";
import { DealsListPage } from "./pages/DealsListPage";
import { DealDetailPage } from "./pages/DealDetailPage";
import { DealFormPage } from "./pages/DealFormPage";
import { TasksPage } from "./pages/TasksPage";
import { CsvImportPage } from "./pages/CsvImportPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { MyAccountPage } from "./pages/MyAccountPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="/contacts/import" element={<CsvImportPage />} />
          <Route path="/contacts" element={<ContactsListPage />}>
            <Route path="new" element={<ContactFormDrawer />} />
            <Route path=":id" element={<ContactDetailDrawer />} />
          </Route>
          <Route path="/companies" element={<CompaniesListPage />} />
          <Route path="/companies/new" element={<CompanyFormPage />} />
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/deals" element={<DealsListPage />} />
          <Route path="/deals/new" element={<DealFormPage />} />
          <Route path="/deals/:id" element={<DealDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/account" element={<MyAccountPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
