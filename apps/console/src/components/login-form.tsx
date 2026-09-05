'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: data.get('secret') }),
    });
    const result = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(result.error ?? 'Login failed');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label htmlFor="secret">Admin secret</label>
      <input
        id="secret"
        name="secret"
        type="password"
        autoComplete="current-password"
        minLength={32}
        required
        autoFocus
      />
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Verifying…' : 'Open console'}
      </button>
    </form>
  );
}
