import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate } from 'react-router-dom';
import { Mail, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { useAction } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Field, BusyButton } from '../components/Common';
import { Brand } from '../components/Brand';
export default function Login() {
  const [register, setRegister] = useState(false);
  const auth = useAuth();
  const schema = z.object({
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z
      .string()
      .min(1, 'Password is required')
      .min(register ? 12 : 1, register ? 'Password must be at least 12 characters' : undefined),
    ...(register
      ? {
          name: z.string().min(1, 'Name is required'),
          organization: z.string().min(1, 'Organization is required'),
        }
      : {}),
  });
  const form = useForm({ resolver: zodResolver(schema) });
  const action = useAction(async (values) => {
    const { data } = await api.post(`/auth/${register ? 'register' : 'login'}`, values);
    auth.login(data);
  }, 'Welcome to Outreach Studio');
  if (auth.authenticated) return <Navigate to="/" replace />;
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <div className="eyebrow">
            <Sparkles size={14} /> INTELLIGENT EMAIL OPERATIONS
          </div>
          <h1>
            From documents.
            <br />
            To conversations.
            <br />
            <em>With confidence.</em>
          </h1>
          <p>
            One connected workspace to understand your documents, craft meaningful emails, and trace
            every send.
          </p>
          <div className="auth-features">
            <span>
              <ShieldCheck /> Human-approved delivery
            </span>
            <span>
              <Mail /> Every message, accounted for
            </span>
          </div>
        </div>
        <small>Built for thoughtful communication.</small>
      </section>
      <section className="auth-form">
        <div className="panel">
          <div className="eyebrow">YOUR OPERATIONS START HERE</div>
          <h2>{register ? 'Create your workspace' : 'Welcome back'}</h2>
          <p>
            {register
              ? 'Set up your organization and start in safe mode.'
              : 'Sign in to your email operations workspace.'}
          </p>
          <form onSubmit={form.handleSubmit((v) => action.mutate(v))}>
            {register && (
              <>
                <Field label="Your name" error={form.formState.errors.name}>
                  <input {...form.register('name')} autoComplete="name" />
                </Field>
                <Field label="Organization" error={form.formState.errors.organization}>
                  <input {...form.register('organization')} autoComplete="organization" />
                </Field>
              </>
            )}
            <Field label="Email address" error={form.formState.errors.email}>
              <input type="email" {...form.register('email')} autoComplete="email" />
            </Field>
            <Field label="Password" error={form.formState.errors.password}>
              <input
                type="password"
                {...form.register('password')}
                autoComplete={register ? 'new-password' : 'current-password'}
              />
            </Field>
            {register && <small>Use at least 12 characters.</small>}
            <BusyButton busy={action.isPending} className="w-full mt-5">
              {register ? 'Create workspace' : 'Sign in'}
              <ArrowRight size={16} />
            </BusyButton>
          </form>
          <button
            className="text-link mt-6"
            onClick={() => {
              setRegister(!register);
              form.reset();
            }}
          >
            {register ? 'Already have an account? Sign in' : 'New to Outreach Studio? Create a workspace'}
          </button>
        </div>
      </section>
    </div>
  );
}
