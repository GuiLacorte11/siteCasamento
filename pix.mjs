import { wedding } from './config.mjs';
const field = (id, value) => `${id}${String(Buffer.byteLength(value)).padStart(2, '0')}${value}`;
export function crc16(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function makePix(amount) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Valor inválido');
  const payload = field('00', '01')
    + field('26', field('00', 'br.gov.bcb.pix') + field('01', wedding.pixKey))
    + field('52', '0000') + field('53', '986') + field('54', amount.toFixed(2))
    + field('58', 'BR') + field('59', wedding.pixName) + field('60', wedding.pixCity)
    + field('62', field('05', '***')) + '6304';
  return payload + crc16(payload);
}
