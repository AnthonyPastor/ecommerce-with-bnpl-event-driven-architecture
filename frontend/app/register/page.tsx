'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ecommerceApi } from '../../lib/ecommerce-api';

const PERKS = [
  'Approved in seconds, no impact on your credit history.',
  'Three equal installments, no interest, no fees.',
  'Track every installment from your account.',
];

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => ecommerceApi.register({ name, email, password }),
    onSuccess: () => router.push('/login'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="flex min-h-[620px] flex-wrap">
      <div className="flex min-w-[300px] flex-1 basis-[460px] items-center justify-center px-6 py-14">
        <div className="flex w-full max-w-[380px] flex-col gap-[22px]">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">New account</span>
            <h1 className="m-0 text-[34px] font-bold leading-[1.05] tracking-tight">Create your Veloce account</h1>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border border-hair px-3.5 py-3 text-[15px] outline-none focus:border-ink"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="test@example.com"
                className="border border-hair px-3.5 py-3 text-[15px] outline-none focus:border-ink"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">Password</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="border border-hair px-3.5 py-3 text-[15px] outline-none focus:border-ink"
              />
            </label>
            {mutation.isError && (
              <p className="m-0 border-l-2 border-red-600 pl-2.5 text-[13px] text-red-600">
                We couldn&apos;t create the account. Try a different email.
              </p>
            )}
            <button
              type="submit"
              disabled={mutation.isPending}
              className="bg-ink py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-70"
            >
              {mutation.isPending ? '…' : 'Create account'}
            </button>
            <Link href="/login" className="py-1.5 text-left text-[13px] text-[#52525b]">
              Already have an account? Log in
            </Link>
          </form>
        </div>
      </div>
      <div className="relative flex min-w-[300px] flex-1 basis-[460px] items-center overflow-hidden bg-ink text-white">
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,45,111,.25) 0 2px, transparent 2px 24px)' }}
        />
        <div className="relative flex max-w-[460px] flex-col gap-7 px-12 py-14">
          <span className="text-[44px] font-extrabold italic uppercase leading-[0.95] tracking-tight">
            Run now, pay in three
          </span>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-3.5">
                <span className="mt-1.5 block h-[7px] w-[7px] shrink-0 bg-accent" />
                <span className="text-sm leading-relaxed text-[#d4d4d8]">{perk}</span>
              </li>
            ))}
          </ul>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#71717a]">
            Veloce Pay · BNPL on an event-driven backend
          </span>
        </div>
      </div>
    </div>
  );
}
