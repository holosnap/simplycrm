import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ContactsListPage } from "./pages/ContactsListPage";
import { ContactDetailPage } from "./pages/ContactDetailPage";
import { ContactFormPage } from "./pages/ContactFormPage";
import { CompaniesListPage } from "./pages/CompaniesListPage";
import { CompanyDetailPage } from "./pages/CompanyDetailPage";
import { CompanyFormPage } from "./pages/CompanyFormPage";
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
          <Route path="/contacts" element={<ContactsListPage />} />
          <Route path="/contacts/new" element={<ContactFormPage />} />
          <Route path="/contacts/import" element={<CsvImportPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/companies" element={<CompaniesListPage />} />
          <Route path="/companies/new" element={<CompanyFormPage />} />
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/account" element={<MyAccountPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
