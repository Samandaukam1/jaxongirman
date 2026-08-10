import { useAuth } from "@/providers/AuthProvider";

export function AccessDeniedPage() {
  const { signOut } = useAuth();
  return (
    <main className="centered-state">
      <div className="state-icon">!</div>
      <h1>Admin huquqi topilmadi</h1>
      <p>Hisobingiz tizimga kirdi, ammo server bu hisobga administrator rolini bermagan.</p>
      <button className="secondary-button" onClick={() => void signOut()}>Boshqa hisob bilan kirish</button>
    </main>
  );
}
