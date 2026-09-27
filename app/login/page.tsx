import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 380, margin: "10vh auto 0" }}>
      <div className="brand" style={{ marginBottom: 18 }}><i />Swing Desk</div>
      <h1>Sign in</h1>
      <p className="sub">Private. Only the owner&apos;s email can get in.</p>
      <LoginForm />
    </div>
  );
}
