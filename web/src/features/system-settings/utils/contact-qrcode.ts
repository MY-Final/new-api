/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/** Mirrors the gateway's cap on the stored contact QR image. */
export const MAX_CONTACT_QRCODE_BYTES = 512 * 1024

export type ContactQRCodeMediaType = 'image/png' | 'image/jpeg'

export type ContactQRCodeFailure = 'unsupported_type' | 'too_large'

export class ContactQRCodeError extends Error {
  constructor(public reason: ContactQRCodeFailure) {
    super(reason)
  }
}

/**
 * Media type of a QR image, decided by the MIME type first and the extension
 * second, because some browsers report an empty type for dragged files.
 */
export function contactQRCodeMediaType(
  file: File
): ContactQRCodeMediaType | null {
  const type = file.type.toLowerCase()
  if (type === 'image/png' || type === 'image/jpeg') return type
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** Encode a picked QR image as the data URI stored by the option API. */
export async function encodeContactQRCode(file: File): Promise<string> {
  const mediaType = contactQRCodeMediaType(file)
  if (!mediaType) throw new ContactQRCodeError('unsupported_type')
  if (file.size > MAX_CONTACT_QRCODE_BYTES) {
    throw new ContactQRCodeError('too_large')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`
}
