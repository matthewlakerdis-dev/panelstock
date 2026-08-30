const encoder = new TextEncoder();
export const normalizeUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validUsername = value => /^[a-z0-9][a-z0-9 ._@-]{0,79}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
async function derive(pin, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000}, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2,'0')).join('');
}
export async function passwordRecord(pin) {
  const salt = randomToken();
  return {algorithm:'pbkdf2-sha256',salt,hash:await derive(pin,salt)};
}
export async function verifyPin(pin, username, user, legacySalt) {
  if (typeof pin !== 'string' || pin.length > 128) return false;
  if (user.password?.algorithm === 'pbkdf2-sha256') return equal(await derive(pin,user.password.salt),user.password.hash);
  return equal(await digest(`${pin}:${username}:${legacySalt || 'panelstock'}`),user.pinHash);
}
export class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
export function requireCondition(condition,message,status=400) { if(!condition) throw new HttpError(status,message); }
