import * as SecureStore from 'expo-secure-store';

/**
 * Pairing token for the public backend. Entered once on the phone and kept in
 * the iOS keychain (this device only, never backed up or synced). It is never
 * in the app bundle, git, or logs.
 */
const KEY = 'cnh.pairingToken';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

let cached: string | null | undefined;

export async function getPairingToken(): Promise<string | null> {
  if (cached === undefined) {
    try {
      cached = await SecureStore.getItemAsync(KEY, OPTIONS);
    } catch {
      cached = null;
    }
  }
  return cached;
}

export async function setPairingToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, OPTIONS);
  cached = token;
}

export async function clearPairingToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, OPTIONS);
  cached = null;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getPairingToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
