import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';
import { useAction } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Field, BusyButton } from '../components/Common';
import { Brand } from '../components/Brand';

function AuthRecoveryFrame({ eyebrow, title, description, children }) {
  return <div className="auth-page auth-recovery-page"><section className="auth-story"><div className="auth-story-nav"><Brand /><span className="auth-security-pill"><ShieldCheck size={14} /> Secure account recovery</span></div><div className="auth-story-content"><div className="eyebrow">OUTREACH STUDIO</div><h1>Back to your<br /><em>workspace.</em></h1><p>Use a secure, time-limited link to set a new password and get back to your campaigns.</p></div></section><section className="auth-form"><div className="auth-card auth-recovery-card"><div className="auth-card-topline"><span>{eyebrow}</span><div><i /><i /><i /></div></div><h2>{title}</h2><p>{description}</p>{children}</div></section></div>;
}

export function ForgotPassword() {
  const auth = useAuth();
  const [sent, setSent] = useState(false);
  const form = useForm({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email address') })) });
  const action = useAction((data) => api.post('/auth/forgot-password', data), '', { onSuccess: () => setSent(true) });
  if (auth.authenticated) return <Navigate to="/" replace />;
  return <AuthRecoveryFrame eyebrow="PASSWORD RECOVERY" title={sent ? 'Check your email' : 'Reset your password'} description={sent ? 'If that email belongs to an account, we’ve sent a secure reset link.' : 'Enter your work email and we’ll send you a secure reset link.'}>{sent ? <><div className="auth-recovery-success"><CheckCircle2 /><span>Link sent. It expires in 2 minutes.</span></div><Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link></> : <form noValidate onSubmit={form.handleSubmit((value) => action.mutate(value))}><Field label="Work email" required error={form.formState.errors.email}><div className="auth-input-wrap"><Mail /><input type="email" autoComplete="email" placeholder="you@company.com" {...form.register('email')} /></div></Field><BusyButton busy={action.isPending} className="auth-submit w-full" type="submit">{action.isPending ? 'Sending link…' : 'Send reset link'}<ArrowRight size={16} /></BusyButton><Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link></form>}</AuthRecoveryFrame>;
}

export function ResetPassword() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const token = params.get('token') || '';
  const [done, setDone] = useState(false);
  const [linkState, setLinkState] = useState(token ? 'checking' : 'missing');
  const schema = z.object({ password: z.string().min(5, 'Use at least 5 characters').refine((value) => /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value), 'Use uppercase, lowercase, number, and special character'), confirm: z.string() }).refine((value) => value.password === value.confirm, { path: ['confirm'], message: 'Passwords do not match' });
  const form = useForm({ resolver: zodResolver(schema) });
  const action = useAction(({ password }) => api.post('/auth/reset-password', { token, password }), '', {
    onSuccess: () => setDone(true),
    onError: (error) => {
      if (/invalid or has expired/i.test(error.response?.data?.detail || '')) setLinkState('expired');
    },
  });
  useEffect(() => {
    if (!token) return undefined;
    let current = true;
    api.get(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .then(({ data }) => { if (current) setLinkState(data.valid ? 'ready' : 'expired'); })
      .catch(() => { if (current) setLinkState('unavailable'); });
    return () => { current = false; };
  }, [token]);
  if (auth.authenticated) return <Navigate to="/" replace />;
  if (!token) return <AuthRecoveryFrame eyebrow="INVALID LINK" title="Reset link missing" description="Please request a new password reset link and open it from your email."><Link className="auth-back-link" to="/forgot-password"><ArrowLeft size={15} /> Request a new link</Link></AuthRecoveryFrame>;
  if (linkState === 'checking') return <AuthRecoveryFrame eyebrow="VERIFYING LINK" title="Checking your secure link" description="Please wait a moment while we verify your password reset request." />;
  if (linkState === 'expired') return <AuthRecoveryFrame eyebrow="LINK EXPIRED" title="This reset link has expired" description="For your protection, password reset links are valid for only 2 minutes and can be used once."><Link className="auth-submit auth-reset-login" to="/forgot-password">Request a new link <ArrowRight size={16} /></Link><Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link></AuthRecoveryFrame>;
  if (linkState === 'unavailable') return <AuthRecoveryFrame eyebrow="LINK CHECK UNAVAILABLE" title="We couldn’t verify this link" description="Check your connection and try again. If it still doesn’t work, request a new reset link."><Link className="auth-back-link" to="/forgot-password"><ArrowLeft size={15} /> Request a new link</Link></AuthRecoveryFrame>;
  return <AuthRecoveryFrame eyebrow="CHOOSE A NEW PASSWORD" title={done ? 'Password updated' : 'Set a new password'} description={done ? 'Your password has been changed. Sign in with your new password.' : 'Use at least 5 characters, including uppercase, lowercase, a number, and a special character.'}>{done ? <Link className="auth-submit auth-reset-login" to="/login">Sign in securely <ArrowRight size={16} /></Link> : <form noValidate onSubmit={form.handleSubmit((value) => action.mutate(value))}><Field label="New password" required error={form.formState.errors.password}><div className="auth-input-wrap"><LockKeyhole /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...form.register('password')} /><button type="button" className="password-toggle" onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field><Field label="Confirm new password" required error={form.formState.errors.confirm}><div className="auth-input-wrap"><KeyRound /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...form.register('confirm')} /></div></Field><BusyButton busy={action.isPending} className="auth-submit w-full" type="submit">{action.isPending ? 'Updating password…' : 'Update password'}<ArrowRight size={16} /></BusyButton></form>}</AuthRecoveryFrame>;
}
