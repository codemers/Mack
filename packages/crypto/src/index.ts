const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function token() {
  return (
    'mack_' +
    b64(crypto.getRandomValues(new Uint8Array(32)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
  );
}
export async function hash(value: string) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function key(secret: string) {
  const bytes = unb64(secret);
  if (bytes.length !== 32) throw new Error('ENCRYPTION_KEY must contain 32 bytes');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(value: unknown, secret: string, connectionId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(connectionId) },
    await key(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}
export async function decrypt<T>(value: string, secret: string, connectionId: string): Promise<T> {
  const [version, iv, data] = value.split('.');
  if (version !== 'v1') throw new Error('Unsupported encryption version');
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(connectionId) },
        await key(secret),
        unb64(data),
      ),
    ),
  );
}
export async function passwordHash(
  password: string,
  salt = b64(crypto.getRandomValues(new Uint8Array(16))),
) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: unb64(salt) },
    material,
    256,
  );
  return `pbkdf2-sha256.100000.${salt}.${b64(new Uint8Array(bits))}`;
}
export async function checkPassword(password: string, stored: string) {
  const candidate = await passwordHash(password, stored.split('.')[2]);
  if (candidate.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
