import { normalizePhone, parsePhone } from '@/lib/phone';

/** Display-only masking. Never use masked values for saving or matching contacts. */
export function maskCustomerPhone(phone: string | null | undefined): string {
  if (!phone?.trim()) return '';
  const { dial, local } = parsePhone(phone);
  const canonical = normalizePhone(local, dial);
  const digits = canonical.replace(/\D/g, '');
  if (local.length <= 4) return '••••';
  if (dial) {
    const hidden = local.length - 4;
    // Preserve the mobile prefix only for normal-length local numbers.
    const prefix = hidden >= 5 ? local[0] : '';
    const dots = '•'.repeat(hidden - prefix.length);
    const groups = [prefix + dots.slice(0, 2), dots.slice(2)].filter(Boolean);
    return `+${dial} ${groups.join(' ')} ${local.slice(-4)}`;
  }
  return `+••• ••• ${digits.slice(-4)}`;
}

export function maskCustomerEmail(email: string | null | undefined): string {
  if (!email?.trim()) return '';
  const [local, domain] = email.trim().split('@');
  if (!local || !domain) return '•••';
  const dot = domain.lastIndexOf('.');
  const suffix = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}•••@${domain[0]}•••${suffix}`;
}
