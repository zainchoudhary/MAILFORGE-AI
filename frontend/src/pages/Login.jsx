import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, Navigate } from 'react-router-dom';
import { Mail, ShieldCheck, Sparkles, ArrowRight, Eye, EyeOff, UserRound, Building2, LockKeyhole, Check } from 'lucide-react';
import { api } from '../services/api';
import { useAction } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Field, BusyButton } from '../components/Common';
import { Brand } from '../components/Brand';
export default function Login() {
  const [register, setRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const auth = useAuth();
  const schema = z.object({
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z
      .string()
      .min(1, 'Password is required')
      .min(register ? 5 : 1, register ? 'Password must be at least 5 characters' : undefined)
      .refine(
        (value) => !register || (/[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)),
        'Use an uppercase letter, lowercase letter, number, and special character',
      ),
    ...(register
      ? {
          name: z.string().min(1, 'Name is required'),
          organization: z.string().min(1, 'Organization is required'),
        }
      : {}),
  });
  const form = useForm({ resolver: zodResolver(schema) });
  const password = form.watch('password') || '';
  const strength = register
    ? [password.length >= 5, /[A-Z]/.test(password), /[a-z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length
    : 0;
  const action = useAction(async (values) => {
    const { data } = await api.post(`/auth/${register ? 'register' : 'login'}`, values);
    auth.login(data);
  }, 'Welcome to Outreach Studio');
  if (auth.authenticated) return <Navigate to="/" replace />;
  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Outreach Studio overview">
        <div className="auth-story-nav">
          <Brand />
          <span className="auth-security-pill"><ShieldCheck size={14} /> Secure workspace</span>
        </div>
        <div className="auth-story-content">
          <div className="eyebrow">
            <Sparkles size={14} /> OUTREACH, MADE INTENTIONAL
          </div>
          <h1>
            Better outreach.
            <br />
            More meaningful
            <br />
            <em>conversations.</em>
          </h1>
          <p>
            Turn documents into thoughtful, accountable communication from one focused workspace.
          </p>
          <div className="auth-features">
            <span>
              <ShieldCheck /> Human-approved delivery
            </span>
            <span>
              <Mail /> Every message, accounted for
            </span>
          </div>
          <div className="auth-preview-card" aria-hidden="true">
            <div className="auth-preview-top"><span /><span /><span /></div>
            <div className="auth-preview-heading"><div className="auth-preview-avatar">A</div><div><b>Alex Morgan</b><small>Product lead · Northstar</small></div><Check /></div>
            <div className="auth-preview-lines"><i /><i /><i /></div>
            <div className="auth-preview-footer"><span>Personalized</span><span>Ready to review</span></div>
          </div>
        </div>
        <small className="auth-story-foot">Built for thoughtful communication.</small>
      </section>
      <section className="auth-form">
        <div className="auth-card">
          <div className="auth-card-topline"><span>{register ? 'START YOUR WORKSPACE' : 'WELCOME BACK'}</span><div><i /><i /><i /></div></div>
          <h2>{register ? 'Create your workspace' : 'Welcome back'}</h2>
          <p>
            {register
              ? 'Bring your outreach workflow into one calm, secure place.'
              : 'Sign in to continue building thoughtful conversations.'}
          </p>
          <form noValidate onSubmit={form.handleSubmit((v) => action.mutate(v))}>
            {register && (
              <div className="auth-field-grid">
                <Field label="Your name" required error={form.formState.errors.name}>
                  <div className="auth-input-wrap"><UserRound aria-hidden="true" /><input placeholder="Alex Morgan" {...form.register('name')} autoComplete="name" aria-invalid={!!form.formState.errors.name} /></div>
                </Field>
                <Field label="Organization" required error={form.formState.errors.organization}>
                  <div className="auth-input-wrap"><Building2 aria-hidden="true" /><input placeholder="Northstar" {...form.register('organization')} autoComplete="organization" aria-invalid={!!form.formState.errors.organization} /></div>
                </Field>
              </div>
            )}
            <Field label="Work email" required error={form.formState.errors.email}>
              <div className="auth-input-wrap"><Mail aria-hidden="true" /><input type="email" placeholder="you@company.com" {...form.register('email')} autoComplete="email" aria-invalid={!!form.formState.errors.email} /></div>
            </Field>
            <Field label="Password" required error={form.formState.errors.password}>
              <div className="auth-input-wrap"><LockKeyhole aria-hidden="true" /><input type={showPassword ? 'text' : 'password'} placeholder={register ? '5+ characters, e.g. Studio1!' : 'Enter your password'} {...form.register('password')} autoComplete={register ? 'new-password' : 'current-password'} aria-invalid={!!form.formState.errors.password} /><button type="button" className="password-toggle" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            </Field>
            {!register && <Link className="forgot-password-link" to="/forgot-password">Forgot password?</Link>}
            {register && <div className="password-strength" aria-label={`Password requirements complete: ${strength} of 5`}><div className={`password-strength-bars strength-${strength}`}><i /><i /><i /></div><span>{password ? ['Use 5+ characters, uppercase, lowercase, number, and special character', 'Add uppercase, number, and special character', 'Add a number and special character', 'Add a special character', 'Almost there — add any missing requirement', 'Password meets all requirements'][strength] : 'Use 5+ characters, uppercase, lowercase, number, and special character'}</span></div>}
            <BusyButton busy={action.isPending} className="auth-submit w-full" type="submit">
              {action.isPending ? (register ? 'Creating workspace…' : 'Signing in…') : (register ? 'Create workspace' : 'Sign in securely')}
              <ArrowRight size={16} />
            </BusyButton>
          </form>
          <button
            className="auth-switch"
            onClick={() => {
              setRegister(!register);
              form.reset();
              setShowPassword(false);
            }}
          >
            <span>{register ? 'Already have an account?' : 'New to Outreach Studio?'}</span> {register ? 'Sign in' : 'Create a workspace'} <ArrowRight size={14} />
          </button>
          <div className="auth-card-foot"><ShieldCheck size={14} /> Your data stays private to your workspace.</div>
        </div>
      </section>
    </div>
  );
}
