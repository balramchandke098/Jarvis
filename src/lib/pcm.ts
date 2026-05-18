export function float32ToPcm16(float32: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

export function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

export function pcmToBase64(pcm16: Int16Array): string {
  const buffer = new ArrayBuffer(pcm16.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcm16.length; i++) {
    view.setInt16(i * 2, pcm16[i], true); // true for little-endian
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToPcm16(base64: string): Int16Array {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(binary.length / 2);
  for (let i = 0; i < pcm16.length; i++) {
    pcm16[i] = view.getInt16(i * 2, true); // true for little-endian
  }
  return pcm16;
}
