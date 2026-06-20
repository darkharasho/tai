/**
 * Single-slot, in-memory store for the user's sudo password. The plaintext
 * lives only here in the main process — never persisted, never sent to the
 * renderer, never logged. Buffers are zero-filled on release.
 */
export class CredentialVault {
  private _secret: Buffer | null = null;
  private _caller: Buffer | null = null;

  set(secret: Buffer): void {
    this._wipe();
    // Copy so callers can't mutate/free our backing store out from under us.
    this._secret = Buffer.from(secret);
    // Zero-fill the caller's original buffer so they can't access it anymore.
    secret.fill(0);
    // Keep a reference to the caller's buffer to zero-fill it on replacement.
    this._caller = secret;
  }

  get(): Buffer | null {
    return this._secret;
  }

  isSet(): boolean {
    return this._secret !== null;
  }

  clear(): void {
    this._wipe();
  }

  private _wipe(): void {
    if (this._secret) {
      this._secret.fill(0);
      this._secret = null;
    }
    if (this._caller) {
      this._caller.fill(0);
      this._caller = null;
    }
  }
}

export const credentialVault = new CredentialVault();
