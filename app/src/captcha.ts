// Sur iOS et Android, pas de captcha pour l'instant : les applis des stores
// passeront par l'attestation d'appareil (App Attest / Play Integrity) plus tard.
export async function getCaptchaToken(): Promise<string | undefined> {
  return undefined;
}
