import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">RESVARY</div>
        <h1>Operator Console</h1>
        <p>
          Enter the admin secret configured for this console instance. One instance can access one
          Resvary project.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
