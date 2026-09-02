const PRIVATE_V4 =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

export function normalizeIp(raw: string) {
  const ip = raw.trim().replace(/^::ffff:/i, '');
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export function isPrivateIp(raw: string) {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  if (ip === 'localhost' || ip === '127.0.0.1') return true;
  return PRIVATE_V4.test(ip);
}

export function isPrivateHost(hostname: string) {
  const host = hostname.trim().toLowerCase().split('%')[0] ?? '';
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  return isPrivateIp(host);
}

export function isPrivateAdminRequest(hostname: string, ip: string) {
  return isPrivateHost(hostname) || isPrivateIp(ip);
}
