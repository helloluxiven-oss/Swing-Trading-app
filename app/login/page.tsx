import LoginForm from "./LoginForm";
import InstallApp from "@/components/InstallApp";

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 380, margin: "10vh auto 0" }}>
      <div className="brand" style={{ marginBottom: 22 }}>
        <img src="/icon-192.png" alt="" width={34} height={34} />
        <span>SIGMORA</span>
        <em>Swing Desk</em>
      </div>
      <h1>Sign in</h1>
      <p className="sub">Private. Only the owner&apos;s email can get in.</p>
      <LoginForm />
      <div style={{ marginTop: 14, textAlign: "center" }}><InstallApp /></div>
    </div>
  );
}
