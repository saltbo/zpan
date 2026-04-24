// Replace DEV key with production key from cloud.zpan.space before Z11
//
// Rotation: add new key to the array; old certs signed by any key in the list
// will continue to verify. Remove a key only after all certs signed by it have
// expired or been re-issued.
//
// DEV placeholder keypair (throwaway — real production key lands via a
// cross-repo PR from cloud's C5 task):
//   secret: k4.secret.K_XrtRH8ozh6oM38rkCz7oHxU_GbKIuExCg2jmBl9_VgfF29_7kGkFAnXvII1bHUBy2Yjw04DRdC4kmbuSND2Q
export const PUBLIC_KEYS: string[] = ['k4.public.YHxdvf-5BpBQJ17yCNWx1ActmI8NOA0XQuJJm7kjQ9k']
